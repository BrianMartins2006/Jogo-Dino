/**
 * Agente Q-Learning Tabular para o Jogo do Dinossauro
 *
 * Espaço de Estados (16 estados discretos):
 *  - Distância (4): 0 = Muito Perto (0–80px), 1 = Perto (81–155px), 2 = Médio (156–245px), 3 = Longe (>245px)
 *  - Obstáculo (2): 0 = Baixo (Cacto simples), 1 = Alto (Cacto alto/duplo)
 *  - Velocidade (2): 0 = Normal (< 7.8 px/f), 1 = Rápida (>= 7.8 px/f)
 *
 * Ações (2):
 *  - 0 = CORRER
 *  - 1 = SALTAR
 */

export const ACTION_RUN = 0;
export const ACTION_JUMP = 1;

export const ACTION_NAMES = ['CORRER', 'SALTAR'];

export const DIST_LABELS = [
  { label: 'Muito Perto', range: '0–80 px' },
  { label: 'Perto', range: '81–155 px' },
  { label: 'Médio', range: '156–245 px' },
  { label: 'Longe', range: '> 245 px' },
];

export const OBS_LABELS = ['Baixo', 'Alto'];
export const SPEED_LABELS = ['Normal', 'Rápida'];

export const NUM_STATES = 16;

export function encodeState(distIndex, obsIndex, speedIndex) {
  const row = speedIndex * 2 + obsIndex; // 0..3
  return row * 4 + distIndex; // 0..15
}

export function decodeState(stateId) {
  const distIndex = stateId % 4;
  const row = Math.floor(stateId / 4);
  const obsIndex = row % 2;
  const speedIndex = Math.floor(row / 2);

  return {
    id: stateId,
    code: `S${String(stateId).padStart(2, '0')}`,
    distIndex,
    obsIndex,
    speedIndex,
    distLabel: DIST_LABELS[distIndex].label,
    distRange: DIST_LABELS[distIndex].range,
    obsLabel: OBS_LABELS[obsIndex],
    speedLabel: SPEED_LABELS[speedIndex],
    summary: `${DIST_LABELS[distIndex].label} · ${OBS_LABELS[obsIndex]} · ${SPEED_LABELS[speedIndex]}`,
  };
}

export function discretizeObservation(distancePx, obsType, speedPxPerFrame) {
  let distIndex = 3;
  if (distancePx <= 80) distIndex = 0;
  else if (distancePx <= 155) distIndex = 1;
  else if (distancePx <= 245) distIndex = 2;

  const obsIndex = obsType === 1 ? 1 : 0;
  const speedIndex = speedPxPerFrame >= 7.8 ? 1 : 0;

  return {
    stateId: encodeState(distIndex, obsIndex, speedIndex),
    distIndex,
    obsIndex,
    speedIndex,
  };
}

export class QLearningAgent {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.25;
    this.gamma = options.gamma ?? 0.9;
    this.epsilon = options.epsilon ?? 0.65;
    this.minEpsilon = options.minEpsilon ?? 0.03;
    this.epsilonDecay = options.epsilonDecay ?? 0.94;
    this.autoDecay = options.autoDecay ?? true;

    this.reset();
  }

  reset() {
    this.qTable = Array.from({ length: NUM_STATES }, () => [0, 0]);
    this.visits = new Array(NUM_STATES).fill(0);
    this.lastUpdate = null;
    this.cellUpdates = Array.from({ length: NUM_STATES }, () => [0, 0]);
    this.totalUpdates = 0;
  }

  getQValues(stateId) {
    return this.qTable[stateId];
  }

  getMaxQ(stateId) {
    const [qRun, qJump] = this.qTable[stateId];
    return Math.max(qRun, qJump);
  }

  getBestAction(stateId) {
    const [qRun, qJump] = this.qTable[stateId];
    if (Math.abs(qJump - qRun) < 1e-6) {
      return ACTION_RUN; // Em empate inicial (0 vs 0), mantém corrida estável
    }
    return qJump > qRun ? ACTION_JUMP : ACTION_RUN;
  }

  chooseAction(stateId) {
    this.visits[stateId] += 1;
    if (Math.random() < this.epsilon) {
      const action = Math.random() < 0.5 ? ACTION_RUN : ACTION_JUMP;
      return { action, mode: 'explore' };
    }
    return { action: this.getBestAction(stateId), mode: 'exploit' };
  }

  update(stateId, action, reward, nextStateId, isTerminal, reason = '') {
    const oldQ = this.qTable[stateId][action];
    const maxNextQ = isTerminal || nextStateId === null ? 0 : this.getMaxQ(nextStateId);
    const target = reward + this.gamma * maxNextQ;
    const newQ = oldQ + this.alpha * (target - oldQ);
    const delta = newQ - oldQ;

    this.qTable[stateId][action] = newQ;
    this.totalUpdates += 1;
    this.cellUpdates[stateId][action] = this.totalUpdates;

    this.lastUpdate = {
      stateId,
      action,
      reward,
      oldQ,
      maxNextQ,
      newQ,
      delta,
      nextStateId,
      isTerminal,
      reason,
      alpha: this.alpha,
      gamma: this.gamma,
      updateSeq: this.totalUpdates,
    };

    return this.lastUpdate;
  }

  decayEpsilon() {
    if (!this.autoDecay) return this.epsilon;
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
    return this.epsilon;
  }
}
