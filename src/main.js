/**
 * Controlador Principal da Interface (DOM + Loop de Animação + Visualizações em Tempo Real)
 */

import { LearningChart } from './chart.js';
import { DinoSimulation } from './game.js';
import {
  ACTION_JUMP,
  ACTION_NAMES,
  ACTION_RUN,
  DIST_LABELS,
  NUM_STATES,
  OBS_LABELS,
  QLearningAgent,
  SPEED_LABELS,
  decodeState,
  encodeState,
} from './qlearning.js';

// Inicialização dos módulos principais
const dinoCanvas = document.getElementById('dino-canvas');
const chartCanvas = document.getElementById('learning-chart');

const agent = new QLearningAgent({
  alpha: 0.25,
  gamma: 0.9,
  epsilon: 0.65,
  minEpsilon: 0.03,
  epsilonDecay: 0.94,
  autoDecay: true,
});

const chart = new LearningChart(chartCanvas);

// Estado de UI
let filterSpeed = 'all';
let filterObs = 'all';
let selectedStateId = 5; // S05 (Perto · Alto · Normal) pré-selecionado para inspeção
let lastActiveStateId = -1;
const cellUpdateSeen = Array.from({ length: NUM_STATES }, () => [0, 0]);
const flashTimers = new Map();

// Referências DOM
const els = {
  btnPlayPause: document.getElementById('btn-play-pause'),
  btnStep: document.getElementById('btn-step'),
  btnResetQ: document.getElementById('btn-reset-q'),
  btnFastTrain: document.getElementById('btn-fast-train'),
  stageStatusText: document.getElementById('stage-status-text'),
  manualHint: document.getElementById('manual-hint'),

  kpiEpisode: document.getElementById('kpi-episode'),
  kpiSteps: document.getElementById('kpi-steps'),
  kpiScore: document.getElementById('kpi-score'),
  kpiAvgScore: document.getElementById('kpi-avg-score'),
  kpiEpsilon: document.getElementById('kpi-epsilon'),
  kpiDecisionMode: document.getElementById('kpi-decision-mode'),
  kpiReward: document.getElementById('kpi-reward'),
  kpiRewardReason: document.getElementById('kpi-reward-reason'),

  sliderAlpha: document.getElementById('slider-alpha'),
  valAlpha: document.getElementById('val-alpha'),
  sliderGamma: document.getElementById('slider-gamma'),
  valGamma: document.getElementById('val-gamma'),
  sliderEpsilon: document.getElementById('slider-epsilon'),
  valEpsilon: document.getElementById('val-epsilon'),
  chkAutoDecay: document.getElementById('chk-auto-decay'),

  bState: document.getElementById('b-state'),
  bAction: document.getElementById('b-action'),
  bNextState: document.getElementById('b-next-state'),
  bOldQ: document.getElementById('b-old-q'),
  bReward: document.getElementById('b-reward'),
  bMaxNext: document.getElementById('b-max-next'),
  bCalcLine: document.getElementById('b-calc-line'),
  bNewQ: document.getElementById('b-new-q'),
  bDelta: document.getElementById('b-delta'),

  liveStateId: document.getElementById('live-state-id'),
  liveSensorRaw: document.getElementById('live-sensor-raw'),
  liveBestAction: document.getElementById('live-best-action'),

  bucketsDist: document.querySelectorAll('#buckets-distance .bucket-item'),
  bucketsObs: document.querySelectorAll('#buckets-obstacle .bucket-item'),
  bucketsSpd: document.querySelectorAll('#buckets-speed .bucket-item'),

  qMatrix: document.getElementById('q-matrix'),
  qTableBody: document.getElementById('q-table-body'),
  inspectorTitle: document.getElementById('inspector-title'),
  inspectorDetail: document.getElementById('inspector-detail'),
};

// Cache de referências de células para atualização ultrarrápida sem reconstruir o DOM a cada frame
const matrixCells = [];
const tableRowRefs = [];

function buildQMatrix() {
  const container = els.qMatrix;
  container.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'matrix-corner';
  corner.textContent = 'Cenário \\ Distância';
  container.appendChild(corner);

  DIST_LABELS.forEach((d) => {
    const colHeader = document.createElement('div');
    colHeader.className = 'matrix-col-header';
    colHeader.innerHTML = `
      <span class="matrix-col-title">${d.label}</span>
      <span class="matrix-col-sub">${d.range}</span>
    `;
    container.appendChild(colHeader);
  });

  for (let spd = 0; spd < 2; spd++) {
    for (let obs = 0; obs < 2; obs++) {
      const rowHeader = document.createElement('div');
      rowHeader.className = 'matrix-row-header';
      rowHeader.innerHTML = `
        <span class="matrix-row-title">Obs. ${OBS_LABELS[obs]}</span>
        <span class="matrix-row-sub">Vel. ${SPEED_LABELS[spd]}</span>
      `;
      container.appendChild(rowHeader);

      for (let dist = 0; dist < 4; dist++) {
        const stateId = encodeState(dist, obs, spd);
        const state = decodeState(stateId);

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'matrix-cell';
        cell.dataset.stateId = String(stateId);
        cell.innerHTML = `
          <div class="m-cell-top">
            <span class="m-state-id">${state.code}</span>
            <span class="m-policy">—</span>
          </div>
          <div class="m-q-pair">
            <div class="m-q-line" data-line="run">
              <span>Correr</span>
              <span class="tabular" data-val="run">0.00</span>
            </div>
            <div class="m-q-line" data-line="jump">
              <span>Saltar</span>
              <span class="tabular" data-val="jump">0.00</span>
            </div>
          </div>
          <div class="m-conf-track">
            <div class="m-conf-fill"></div>
          </div>
        `;

        cell.addEventListener('click', () => {
          selectedStateId = stateId;
          updateRowInspector();
          syncSelectionStyles();
        });

        container.appendChild(cell);
        matrixCells[stateId] = {
          root: cell,
          policy: cell.querySelector('.m-policy'),
          lineRun: cell.querySelector('[data-line="run"]'),
          lineJump: cell.querySelector('[data-line="jump"]'),
          valRun: cell.querySelector('[data-val="run"]'),
          valJump: cell.querySelector('[data-val="jump"]'),
          fill: cell.querySelector('.m-conf-fill'),
        };
      }
    }
  }
}

function buildQTable() {
  const tbody = els.qTableBody;
  tbody.innerHTML = '';

  for (let stateId = 0; stateId < NUM_STATES; stateId++) {
    const s = decodeState(stateId);
    const tr = document.createElement('tr');
    tr.dataset.stateId = String(stateId);
    tr.dataset.obs = String(s.obsIndex);
    tr.dataset.spd = String(s.speedIndex);

    tr.innerHTML = `
      <td class="state-tag-cell">
        <span>${s.code}</span>
        <span class="active-marker hidden">Atual</span>
      </td>
      <td>${s.distLabel} <span class="panel-meta tabular">(${s.distRange})</span></td>
      <td>${s.obsLabel}</td>
      <td>${s.speedLabel}</td>
      <td class="num-col"><span class="q-cell-val q-zero" data-q="run">0.00</span></td>
      <td class="num-col"><span class="q-cell-val q-zero" data-q="jump">0.00</span></td>
      <td>
        <div class="adv-bar-wrap">
          <div class="adv-track">
            <div class="adv-center"></div>
            <div class="adv-fill run" style="left: 50%; width: 0%;"></div>
          </div>
        </div>
      </td>
      <td><span class="policy-text">—</span></td>
      <td class="num-col tabular" data-visits>0</td>
    `;

    tr.addEventListener('click', () => {
      selectedStateId = stateId;
      updateRowInspector();
      syncSelectionStyles();
    });

    tbody.appendChild(tr);
    tableRowRefs[stateId] = {
      tr,
      activeMarker: tr.querySelector('.active-marker'),
      qRunEl: tr.querySelector('[data-q="run"]'),
      qJumpEl: tr.querySelector('[data-q="jump"]'),
      advFill: tr.querySelector('.adv-fill'),
      policyEl: tr.querySelector('.policy-text'),
      visitsEl: tr.querySelector('[data-visits]'),
    };
  }
}

function triggerCellFlash(el, delta) {
  el.classList.remove('flash-pos', 'flash-neg');
  void el.offsetWidth; // força reflow para reiniciar transição
  el.classList.add(delta >= 0 ? 'flash-pos' : 'flash-neg');

  const prevTimer = flashTimers.get(el);
  if (prevTimer) clearTimeout(prevTimer);
  const timer = setTimeout(() => {
    el.classList.remove('flash-pos', 'flash-neg');
  }, 420);
  flashTimers.set(el, timer);
}

function formatQClass(val) {
  if (val > 0.05) return 'q-pos';
  if (val < -0.05) return 'q-neg';
  return 'q-zero';
}

function updateMemoryViews(activeStateId) {
  for (let stateId = 0; stateId < NUM_STATES; stateId++) {
    const [qRun, qJump] = agent.getQValues(stateId);
    const visits = agent.visits[stateId];
    const diff = qJump - qRun;
    const isNeutral = Math.abs(diff) < 1e-4 && Math.abs(qRun) < 1e-4 && Math.abs(qJump) < 1e-4;
    const preferJump = diff > 1e-4;
    const confPct = Math.min(100, (Math.abs(diff) / 18) * 100);

    // 1. Atualizar Célula na Matriz 4x4
    const mc = matrixCells[stateId];
    mc.valRun.textContent = qRun.toFixed(2);
    mc.valJump.textContent = qJump.toFixed(2);

    mc.root.classList.toggle('is-active', stateId === activeStateId);
    mc.root.classList.toggle('pref-run', !isNeutral && !preferJump);
    mc.root.classList.toggle('pref-jump', !isNeutral && preferJump);

    mc.lineRun.classList.toggle('winner', !isNeutral && !preferJump);
    mc.lineJump.classList.toggle('winner', !isNeutral && preferJump);

    if (isNeutral) {
      mc.policy.textContent = '○ Neutro';
      mc.policy.className = 'm-policy legend-neutral';
      mc.fill.style.width = '0%';
    } else if (preferJump) {
      mc.policy.textContent = '▲ Saltar';
      mc.policy.className = 'm-policy action-jump-text';
      mc.fill.className = 'm-conf-fill fill-jump';
      mc.fill.style.width = `${confPct.toFixed(0)}%`;
    } else {
      mc.policy.textContent = '■ Correr';
      mc.policy.className = 'm-policy action-run-text';
      mc.fill.className = 'm-conf-fill fill-run';
      mc.fill.style.width = `${confPct.toFixed(0)}%`;
    }

    // 2. Atualizar Linha na Tabela Q
    const row = tableRowRefs[stateId];
    row.tr.classList.toggle('is-active-row', stateId === activeStateId);
    row.activeMarker.classList.toggle('hidden', stateId !== activeStateId);

    row.qRunEl.textContent = qRun.toFixed(2);
    row.qRunEl.className = `q-cell-val ${formatQClass(qRun)}`;
    row.qJumpEl.textContent = qJump.toFixed(2);
    row.qJumpEl.className = `q-cell-val ${formatQClass(qJump)}`;

    // Flash quando houver atualização recente nesta célula
    if (agent.cellUpdates[stateId][ACTION_RUN] !== cellUpdateSeen[stateId][ACTION_RUN]) {
      cellUpdateSeen[stateId][ACTION_RUN] = agent.cellUpdates[stateId][ACTION_RUN];
      const delta = agent.lastUpdate?.stateId === stateId ? agent.lastUpdate.delta : 1;
      triggerCellFlash(row.qRunEl, delta);
    }
    if (agent.cellUpdates[stateId][ACTION_JUMP] !== cellUpdateSeen[stateId][ACTION_JUMP]) {
      cellUpdateSeen[stateId][ACTION_JUMP] = agent.cellUpdates[stateId][ACTION_JUMP];
      const delta = agent.lastUpdate?.stateId === stateId ? agent.lastUpdate.delta : 1;
      triggerCellFlash(row.qJumpEl, delta);
    }

    // Barra de vantagem relativa (esquerda = Correr, direita = Saltar)
    const halfWidth = Math.min(50, (Math.abs(diff) / 20) * 50);
    if (isNeutral) {
      row.advFill.style.left = '50%';
      row.advFill.style.width = '0%';
      row.policyEl.textContent = '○ Sem preferência';
      row.policyEl.className = 'policy-text legend-neutral';
    } else if (preferJump) {
      row.advFill.className = 'adv-fill jump';
      row.advFill.style.left = '50%';
      row.advFill.style.width = `${halfWidth.toFixed(1)}%`;
      row.policyEl.textContent = '▲ SALTAR';
      row.policyEl.className = 'policy-text action-jump-text';
    } else {
      row.advFill.className = 'adv-fill run';
      row.advFill.style.left = `${(50 - halfWidth).toFixed(1)}%`;
      row.advFill.style.width = `${halfWidth.toFixed(1)}%`;
      row.policyEl.textContent = '■ CORRER';
      row.policyEl.className = 'policy-text action-run-text';
    }

    row.visitsEl.textContent = String(visits);
  }

  updateRowInspector();
}

function syncSelectionStyles() {
  for (let stateId = 0; stateId < NUM_STATES; stateId++) {
    tableRowRefs[stateId].tr.classList.toggle('is-selected-row', stateId === selectedStateId);
  }
}

function applyTableFilters() {
  for (let stateId = 0; stateId < NUM_STATES; stateId++) {
    const row = tableRowRefs[stateId].tr;
    const matchSpeed = filterSpeed === 'all' || row.dataset.spd === filterSpeed;
    const matchObs = filterObs === 'all' || row.dataset.obs === filterObs;
    row.classList.toggle('hidden', !(matchSpeed && matchObs));
  }
}

function updateRowInspector() {
  const s = decodeState(selectedStateId);
  const [qRun, qJump] = agent.getQValues(selectedStateId);
  const best = agent.getBestAction(selectedStateId);
  const diff = Math.abs(qJump - qRun);

  els.inspectorTitle.textContent = `Estado ${s.code} (${s.summary})`;
  if (Math.abs(qJump - qRun) < 1e-4 && Math.abs(qRun) < 1e-4) {
    els.inspectorDetail.textContent = `Q(Correr) = 0.00 · Q(Saltar) = 0.00 — Estado ainda não diferenciado; o agente mantém corrida até explorar.`;
  } else {
    els.inspectorDetail.textContent = `Q(Correr) = ${qRun.toFixed(2)} · Q(Saltar) = ${qJump.toFixed(
      2
    )} · Vantagem de ${ACTION_NAMES[best]}: +${diff.toFixed(2)} (${agent.visits[selectedStateId]} visitas)`;
  }
}

function updateBellmanInspector(info) {
  if (!info) {
    els.bState.textContent = '—';
    els.bAction.textContent = '—';
    els.bNextState.textContent = '—';
    els.bOldQ.textContent = '0.00';
    els.bReward.textContent = '0.0';
    els.bMaxNext.textContent = '0.00';
    els.bCalcLine.textContent = 'Aguardando primeira transição...';
    els.bNewQ.textContent = '0.00';
    els.bDelta.textContent = 'Δ 0.00';
    els.bDelta.className = 'result-delta tabular';
    return;
  }

  const sPrev = decodeState(info.stateId);
  const sNext = info.nextStateId !== null ? decodeState(info.nextStateId) : null;
  const actionLabel = ACTION_NAMES[info.action];

  els.bState.textContent = `${sPrev.code} (${sPrev.distLabel} · ${sPrev.obsLabel})`;
  els.bAction.textContent = info.action === ACTION_JUMP ? `▲ ${actionLabel}` : `■ ${actionLabel}`;
  els.bAction.className =
    info.action === ACTION_JUMP ? 'b-val action-jump-text' : 'b-val action-run-text';
  els.bNextState.textContent = info.isTerminal
    ? `Estado terminal (${info.reason})`
    : `${sNext.code} (${sNext.distLabel} · ${sNext.obsLabel})`;

  els.bOldQ.textContent = info.oldQ.toFixed(2);
  els.bReward.textContent = `${info.reward >= 0 ? '+' : ''}${info.reward.toFixed(1)}`;
  els.bMaxNext.textContent = info.maxNextQ.toFixed(2);

  const deltaSign = info.delta >= 0 ? '+' : '';
  els.bCalcLine.textContent = `${info.oldQ.toFixed(2)} + ${info.alpha.toFixed(
    2
  )} · [${info.reward.toFixed(1)} + ${info.gamma.toFixed(2)}·${info.maxNextQ.toFixed(
    2
  )} − ${info.oldQ.toFixed(2)}]`;
  els.bNewQ.textContent = info.newQ.toFixed(2);
  els.bDelta.textContent = `${info.delta >= 0 ? '▲' : '▼'} Δ ${deltaSign}${info.delta.toFixed(2)}`;
  els.bDelta.className = `result-delta tabular ${info.delta >= 0 ? 'delta-pos' : 'delta-neg'}`;
}

function updateStateDimensionsUI(snapshot) {
  const { observation, stateInfo } = snapshot;

  if (observation.stateId !== lastActiveStateId) {
    lastActiveStateId = observation.stateId;
    els.bucketsDist.forEach((li) => {
      li.classList.toggle('active', Number(li.dataset.dist) === observation.distIndex);
    });
    els.bucketsObs.forEach((li) => {
      li.classList.toggle('active', Number(li.dataset.obs) === observation.obsIndex);
    });
    els.bucketsSpd.forEach((li) => {
      li.classList.toggle('active', Number(li.dataset.spd) === observation.speedIndex);
    });
  }

  els.liveStateId.textContent = `${stateInfo.code} (${stateInfo.summary})`;
  els.liveSensorRaw.textContent = `Distância: ${observation.rawDistance} px · Obstáculo: ${
    stateInfo.obsLabel
  } · Velocidade: ${observation.speed.toFixed(1)} px/frame`;

  const best = agent.getBestAction(observation.stateId);
  els.liveBestAction.textContent =
    best === ACTION_JUMP ? '▲ SALTAR (Maior Q)' : '■ CORRER (Maior Q)';
  els.liveBestAction.className =
    best === ACTION_JUMP ? 'live-action action-jump-text' : 'live-action action-run-text';
}

function handleSimUpdate(snapshot) {
  els.kpiEpisode.textContent = String(snapshot.episode);
  els.kpiSteps.textContent = `${snapshot.decisionCount} decisões tomadas`;
  els.kpiScore.textContent = `${snapshot.score} / ${snapshot.bestScore}`;
  els.kpiAvgScore.textContent = `Média (10 ep.): ${snapshot.avg10.toFixed(1)}`;

  const epsPct = (snapshot.epsilon * 100).toFixed(1);
  els.kpiEpsilon.textContent = `${epsPct}%`;
  els.kpiDecisionMode.textContent = snapshot.lastDecisionMode;

  // Sincroniza slider de epsilon quando decai automaticamente
  if (agent.autoDecay) {
    els.sliderEpsilon.value = snapshot.epsilon.toFixed(2);
    els.valEpsilon.textContent = snapshot.epsilon.toFixed(2);
  }

  const r = snapshot.lastReward;
  els.kpiReward.textContent = `${r >= 0 ? '+' : ''}${r.toFixed(1)}`;
  els.kpiReward.className = `kpi-value tabular ${r > 0 ? 'val-pos' : r < 0 ? 'val-neg' : ''}`;
  els.kpiRewardReason.textContent = snapshot.lastRewardReason;

  updateStateDimensionsUI(snapshot);
  updateMemoryViews(snapshot.observation.stateId);
}

// Instancia simulação
const sim = new DinoSimulation(dinoCanvas, agent, {
  onUpdate: handleSimUpdate,
  onEpisodeEnd: (history) => {
    chart.draw(history);
  },
  onBellmanUpdate: (info) => {
    updateBellmanInspector(info);
  },
});

// Construir DOM inicial
buildQMatrix();
buildQTable();
syncSelectionStyles();
chart.draw([]);

// Eventos de Botões Principais
els.btnPlayPause.addEventListener('click', () => {
  sim.running = !sim.running;
  els.btnPlayPause.textContent = sim.running ? 'Pausar' : 'Continuar';
  els.btnStep.disabled = sim.running;
  els.stageStatusText.textContent = sim.running
    ? `${sim.mode === 'ai' ? 'Agente IA' : 'Modo Manual'} em execução · Sensores visuais ativos`
    : 'Simulação pausada · Use "Passo Único" para inspecionar cada decisão';
});

els.btnStep.disabled = true; // começa rodando
els.btnStep.addEventListener('click', () => {
  if (!sim.running) {
    sim.stepOnce();
  }
});

els.btnResetQ.addEventListener('click', () => {
  agent.epsilon = Number(els.sliderEpsilon.value);
  if (agent.autoDecay) {
    agent.epsilon = 0.65;
    els.sliderEpsilon.value = '0.65';
    els.valEpsilon.textContent = '0.65';
  }
  sim.resetAll();
  updateBellmanInspector(null);
  chart.draw([]);
});

els.btnFastTrain.addEventListener('click', () => {
  sim.trainEpisodesBatch(50);
});

// Controles Segmentados de Velocidade
document.querySelectorAll('[data-speed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    sim.speedMultiplier = Number(btn.dataset.speed);
  });
});

// Controles Segmentados de Modo (Agente IA vs Manual)
document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    sim.setMode(btn.dataset.mode);
    const isManual = sim.mode === 'manual';
    els.manualHint.classList.toggle('hidden', !isManual);
    els.stageStatusText.textContent = isManual
      ? 'Controle Manual ativo · Tabela Q preservada'
      : 'Agente IA em execução · Sensores visuais ativos';
  });
});

// Controles de Teclado & Clique no Canvas para Modo Manual
window.addEventListener('keydown', (e) => {
  if (sim.mode === 'manual' && !e.repeat && !e.target.closest?.('button, input, select, textarea') && (e.code === 'Space' || e.code === 'ArrowUp')) {
    e.preventDefault();
    sim.queueManualJump();
  }
});

dinoCanvas.addEventListener('pointerdown', () => {
  if (sim.mode === 'manual') {
    sim.queueManualJump();
  }
});

// Sliders de Hiperparâmetros
els.sliderAlpha.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  agent.alpha = val;
  els.valAlpha.textContent = val.toFixed(2);
});

els.sliderGamma.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  agent.gamma = val;
  els.valGamma.textContent = val.toFixed(2);
});

els.sliderEpsilon.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  agent.epsilon = val;
  els.valEpsilon.textContent = val.toFixed(2);
  els.kpiEpsilon.textContent = `${(val * 100).toFixed(1)}%`;
});

els.chkAutoDecay.addEventListener('change', (e) => {
  agent.autoDecay = e.target.checked;
});

// Filtros da Tabela Q
document.querySelectorAll('[data-filter-speed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter-speed]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filterSpeed = btn.dataset.filterSpeed;
    applyTableFilters();
  });
});

document.querySelectorAll('[data-filter-obs]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter-obs]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filterObs = btn.dataset.filterObs;
    applyTableFilters();
  });
});

// Loop Principal de Animação (60 FPS)
const frameInterval = 1000 / 60;
let previousTime;
let elapsed = 0;

function loop(time) {
  elapsed = sim.running ? elapsed + Math.min(time - (previousTime ?? time), 100) : 0;
  previousTime = time;
  while (elapsed >= frameInterval) {
    sim.tick();
    elapsed -= frameInterval;
  }
  requestAnimationFrame(loop);
}

sim.draw();
handleSimUpdate(sim.getSnapshot());
requestAnimationFrame(loop);
