/**
 * Motor de Simulação em Canvas Puro para o Jogo do Dinossauro + Q-Learning
 */

import {
  ACTION_JUMP,
  ACTION_NAMES,
  ACTION_RUN,
  decodeState,
  discretizeObservation,
} from './qlearning.js';

const CANVAS_W = 760;
const CANVAS_H = 280;
const GROUND_Y = 228;

const DINO_X = 84;
const DINO_W = 38;
const DINO_H = 44;

const GRAVITY = 0.72;
const JUMP_VELOCITY = -13.2;
const BASE_SPEED = 6.2;
const MAX_SPEED = 10.2;
const MAX_EPISODE_FRAMES = 2200;

export class DinoSimulation {
  constructor(canvas, agent, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.agent = agent;
    this.onUpdate = callbacks.onUpdate || (() => {});
    this.onEpisodeEnd = callbacks.onEpisodeEnd || (() => {});
    this.onBellmanUpdate = callbacks.onBellmanUpdate || (() => {});

    this.running = true;
    this.speedMultiplier = 1;
    this.mode = 'ai'; // 'ai' | 'manual'

    this.episode = 1;
    this.bestScore = 0;
    this.scoresHistory = [];
    this.decisionCount = 0;

    this.lastReward = 0;
    this.lastRewardReason = 'Iniciando episódio';
    this.lastDecisionMode = '—';
    this.lastAction = ACTION_RUN;

    this.manualJumpQueued = false;
    this.crashFreezeFrames = 0;

    this.clouds = [
      { x: 180, y: 54, w: 46 },
      { x: 430, y: 38, w: 58 },
      { x: 640, y: 66, w: 42 },
    ];
    this.groundDots = Array.from({ length: 28 }, (_, i) => ({
      x: i * 30 + (i % 3) * 8,
      w: (i % 4) + 2,
      yOffset: (i % 3) * 5 + 6,
    }));

    this.floatingTexts = [];
    this.resetEpisode(true);
  }

  resetAll() {
    this.agent.reset();
    this.episode = 1;
    this.bestScore = 0;
    this.scoresHistory = [];
    this.decisionCount = 0;
    this.lastReward = 0;
    this.lastRewardReason = 'Memória Q zerada';
    this.lastDecisionMode = '—';
    this.lastAction = ACTION_RUN;
    this.floatingTexts = [];
    this.resetEpisode(true);
    this.onUpdate(this.getSnapshot());
  }

  resetEpisode(initial = false) {
    this.dino = {
      x: DINO_X,
      y: GROUND_Y - DINO_H,
      vy: 0,
      width: DINO_W,
      height: DINO_H,
      onGround: true,
      crashed: false,
      legPhase: 0,
    };

    this.speed = BASE_SPEED;
    this.score = 0;
    this.frameCount = 0;
    this.pendingTransition = null;
    this.manualJumpQueued = false;
    this.crashFreezeFrames = 0;

    // Primeiro obstáculo posicionado a uma distância confortável
    this.obstacles = [this.createObstacle(480)];

    if (!initial) {
      this.episode += 1;
    }

    const obs = this.observe();
    this.currentObservation = obs;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.lastAction = ACTION_RUN;
    this.lastDecisionMode = '—';
    this.lastReward = 0;
    this.lastRewardReason = 'Iniciando episódio';
    this.floatingTexts = [];
    this.resetEpisode(true);
    this.draw();
    this.onUpdate(this.getSnapshot());
  }

  createObstacle(xPos) {
    const type = Math.random() < 0.52 ? 0 : 1; // 0 = Baixo, 1 = Alto
    if (type === 0) {
      return {
        x: xPos,
        y: GROUND_Y - 34,
        width: 22,
        height: 34,
        type: 0,
        passed: false,
      };
    }
    return {
      x: xPos,
      y: GROUND_Y - 52,
      width: 38,
      height: 52,
      type: 1,
      passed: false,
    };
  }

  getNextObstacle() {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (o.x + o.width >= this.dino.x + 6) {
        return o;
      }
    }
    return null;
  }

  observe() {
    const nextObs = this.getNextObstacle();
    const rawDistance = nextObs
      ? Math.max(0, Math.round(nextObs.x - (this.dino.x + this.dino.width)))
      : 400;
    const obsType = nextObs ? nextObs.type : 0;
    const disc = discretizeObservation(rawDistance, obsType, this.speed);

    return {
      ...disc,
      rawDistance,
      obsType,
      speed: this.speed,
      nextObstacle: nextObs,
    };
  }

  queueManualJump() {
    if (this.mode === 'manual' && this.dino.onGround && !this.dino.crashed) {
      this.manualJumpQueued = true;
    }
  }

  spawnFloatingText(text, x, y, color) {
    if (this.speedMultiplier > 5) return; // Evita poluição visual em modo turbo
    this.floatingTexts.push({
      text,
      x,
      y,
      color,
      life: 36,
      maxLife: 36,
    });
  }

  triggerJump() {
    this.dino.vy = JUMP_VELOCITY;
    this.dino.onGround = false;
  }

  stepFrame(headless = false) {
    if (this.crashFreezeFrames > 0) {
      this.crashFreezeFrames -= 1;
      if (this.crashFreezeFrames === 0) {
        this.finishEpisode(headless);
        return { updatedQ: false, episodeEnded: true };
      }
      return { updatedQ: false, episodeEnded: false };
    }

    this.frameCount += 1;
    let updatedQ = false;

    // 1. Movimentar cenário e obstáculos
    this.obstacles.forEach((obs) => {
      obs.x -= this.speed;
      if (!obs.passed && obs.x + obs.width < this.dino.x) {
        obs.passed = true;
        this.score += 1;
        this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.score * 0.22);
        if (this.pendingTransition) {
          this.pendingTransition.clearedObstacle = true;
        }
        if (!headless && this.dino.y < GROUND_Y - this.dino.height - 6) {
          this.spawnFloatingText('+15', this.dino.x + 12, this.dino.y - 10, '#059669');
        }
      }
    });

    // Remover obstáculos fora da tela e gerar novos
    if (this.obstacles.length > 0 && this.obstacles[0].x + this.obstacles[0].width < -40) {
      this.obstacles.shift();
    }

    const lastObs = this.obstacles[this.obstacles.length - 1];
    if (!lastObs || lastObs.x < CANVAS_W - 120) {
      const minGap = 275 + (this.speed - BASE_SPEED) * 26;
      const gap = minGap + Math.random() * 145;
      const spawnX = lastObs ? Math.max(CANVAS_W + 20, lastObs.x + lastObs.width + gap) : CANVAS_W + 40;
      this.obstacles.push(this.createObstacle(spawnX));
    }

    // 2. Física do Dinossauro
    if (!this.dino.onGround) {
      this.dino.vy += GRAVITY;
      this.dino.y += this.dino.vy;
      if (this.dino.y >= GROUND_Y - this.dino.height) {
        this.dino.y = GROUND_Y - this.dino.height;
        this.dino.vy = 0;
        this.dino.onGround = true;
      }
    } else {
      this.dino.legPhase += 0.28;
    }

    // Parallax leve de nuvens e solo
    if (!headless) {
      this.clouds.forEach((c) => {
        c.x -= this.speed * 0.16;
        if (c.x + c.w < -20) c.x = CANVAS_W + 30;
      });
      this.groundDots.forEach((d) => {
        d.x -= this.speed;
        if (d.x + d.w < 0) d.x = CANVAS_W + Math.random() * 24;
      });
      this.floatingTexts = this.floatingTexts.filter((ft) => {
        ft.y -= 0.8;
        ft.life -= 1;
        return ft.life > 0;
      });
    }

    // 3. Checar Colisão
    const crashed = this.checkCollision();
    this.currentObservation = this.observe();

    if (crashed) {
      this.dino.crashed = true;
      this.lastReward = -100;
      this.lastRewardReason = 'Colisão com obstáculo';

      if (this.mode === 'ai') {
        const stateToUpdate = this.pendingTransition
          ? this.pendingTransition.stateId
          : this.currentObservation.stateId;
        const actionToUpdate = this.pendingTransition
          ? this.pendingTransition.action
          : ACTION_RUN;

        const updateInfo = this.agent.update(
          stateToUpdate,
          actionToUpdate,
          -100,
          null,
          true,
          'Colisão com obstáculo'
        );
        updatedQ = true;
        if (!headless) {
          this.onBellmanUpdate(updateInfo);
          this.spawnFloatingText('-100', this.dino.x + 12, this.dino.y - 12, '#dc2626');
        }
      }

      if (!headless && this.speedMultiplier <= 5) {
        this.crashFreezeFrames = 14;
        return { updatedQ, episodeEnded: false };
      }

      this.finishEpisode(headless);
      return { updatedQ, episodeEnded: true };
    }

    // 4. Ciclo de Decisão e Atualização Q-Learning (apenas no chão)
    if (this.dino.onGround) {
      const reachedLimit = this.mode === 'ai' && this.frameCount >= MAX_EPISODE_FRAMES;
      if (this.mode === 'ai') {
        if (this.pendingTransition) {
          const isJumpLanding = this.pendingTransition.action === ACTION_JUMP;
          const stateChanged =
            this.currentObservation.stateId !== this.pendingTransition.stateId;
          this.pendingTransition.ticks += 1;

          const shouldResolveRun =
            !isJumpLanding &&
            (reachedLimit ||
              stateChanged ||
              this.pendingTransition.ticks >= 6 ||
              this.pendingTransition.clearedObstacle);

          if (isJumpLanding || shouldResolveRun) {
            let reward = 0.5;
            let reason = 'Correu em segurança';

            if (isJumpLanding) {
              if (this.pendingTransition.clearedObstacle) {
                reward = 15.0;
                reason = 'Superou obstáculo com salto';
              } else {
                reward = -3.0;
                reason = 'Salto desnecessário';
                if (!headless) {
                  this.spawnFloatingText('-3', this.dino.x + 12, this.dino.y - 10, '#b45309');
                }
              }
            } else if (this.pendingTransition.clearedObstacle) {
              reward = 15.0;
              reason = 'Superou obstáculo';
            }

            this.lastReward = reward;
            this.lastRewardReason = reason;

            const updateInfo = this.agent.update(
              this.pendingTransition.stateId,
              this.pendingTransition.action,
              reward,
              reachedLimit ? null : this.currentObservation.stateId,
              reachedLimit,
              reachedLimit ? 'Limite do episódio' : reason
            );
            updatedQ = true;
            this.pendingTransition = null;
            if (!headless) {
              this.onBellmanUpdate(updateInfo);
            }
          }
        }

        if (reachedLimit) {
          this.finishEpisode(headless);
          return { updatedQ, episodeEnded: true };
        }

        // Se não há transição pendente, tomar nova decisão no estado atual
        if (!this.pendingTransition) {
          const { action, mode } = this.agent.chooseAction(this.currentObservation.stateId);
          this.lastAction = action;
          this.lastDecisionMode = mode === 'explore' ? 'Exploração (ε)' : 'Explotação (Máx Q)';
          this.decisionCount += 1;

          if (action === ACTION_JUMP) {
            this.triggerJump();
          }

          this.pendingTransition = {
            stateId: this.currentObservation.stateId,
            action,
            ticks: 0,
            clearedObstacle: false,
            mode,
          };
        }
      } else {
        // Modo Manual
        this.lastDecisionMode = 'Controle Manual';
        if (this.manualJumpQueued) {
          this.manualJumpQueued = false;
          this.lastAction = ACTION_JUMP;
          this.triggerJump();
        } else {
          this.lastAction = ACTION_RUN;
        }
      }
    }

    return { updatedQ, episodeEnded: false };
  }

  finishEpisode(headless = false) {
    if (this.mode === 'ai') {
      this.bestScore = Math.max(this.bestScore, this.score);
      this.scoresHistory.push(this.score);
      this.agent.decayEpsilon();
    }

    this.resetEpisode(this.mode === 'manual');

    if (!headless && this.mode === 'ai') {
      this.onEpisodeEnd(this.scoresHistory);
    }
  }

  checkCollision() {
    const dinoBox = {
      x: this.dino.x + 8,
      y: this.dino.y + 5,
      w: this.dino.width - 16,
      h: this.dino.height - 8,
    };

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      const obsBox = {
        x: obs.x + 3,
        y: obs.y + 3,
        w: obs.width - 6,
        h: obs.height - 4,
      };

      const overlap =
        dinoBox.x < obsBox.x + obsBox.w &&
        dinoBox.x + dinoBox.w > obsBox.x &&
        dinoBox.y < obsBox.y + obsBox.h &&
        dinoBox.y + dinoBox.h > obsBox.y;

      if (overlap) return true;
    }
    return false;
  }

  stepOnce() {
    // Avança frames até ocorrer uma atualização Q ou mudança de decisão relevante
    const maxFrames = 45;
    for (let i = 0; i < maxFrames; i++) {
      const res = this.stepFrame(false);
      if (res.updatedQ || res.episodeEnded || i === maxFrames - 1) {
        break;
      }
    }
    this.draw();
    this.onUpdate(this.getSnapshot());
  }

  trainEpisodesBatch(count = 50) {
    const prevMode = this.mode;
    this.setMode('ai');

    for (let episode = 0; episode < count; episode++) {
      while (!this.stepFrame(true).episodeEnded) {
        // O mesmo motor encerra o episódio por colisão ou pelo limite de quadros.
      }
    }

    this.setMode(prevMode);
    this.draw();
    if (this.agent.lastUpdate) {
      this.onBellmanUpdate(this.agent.lastUpdate);
    }
    this.onEpisodeEnd(this.scoresHistory);
    this.onUpdate(this.getSnapshot());
  }

  tick() {
    if (!this.running) return;
    const steps = this.mode === 'manual' ? 1 : this.speedMultiplier;
    for (let i = 0; i < steps; i++) {
      const result = this.stepFrame(i < steps - 1);
      if (result.episodeEnded && i < steps - 1) {
        this.onEpisodeEnd(this.scoresHistory);
      }
    }
    this.draw();
    if (this.agent.lastUpdate) this.onBellmanUpdate(this.agent.lastUpdate);
    this.onUpdate(this.getSnapshot());
  }

  getSnapshot() {
    const obs = this.currentObservation || this.observe();
    const recent = this.scoresHistory.slice(-10);
    const avg10 =
      recent.length > 0 ? recent.reduce((sum, v) => sum + v, 0) / recent.length : 0;

    return {
      episode: this.episode,
      score: this.score,
      bestScore: this.bestScore,
      avg10,
      decisionCount: this.decisionCount,
      epsilon: this.agent.epsilon,
      lastReward: this.lastReward,
      lastRewardReason: this.lastRewardReason,
      lastDecisionMode: this.lastDecisionMode,
      lastAction: this.lastAction,
      observation: obs,
      stateInfo: decodeState(obs.stateId),
      running: this.running,
      mode: this.mode,
    };
  }

  draw() {
    const ctx = this.ctx;
    const w = CANVAS_W;
    const h = CANVAS_H;

    // 1. Céu limpo
    ctx.fillStyle = '#fbfcfe';
    ctx.fillRect(0, 0, w, h);

    // Nuvens discretas
    ctx.fillStyle = '#e2e8f0';
    this.clouds.forEach((c) => {
      ctx.beginPath();
      ctx.roundRect(c.x, c.y, c.w, 12, 6);
      ctx.roundRect(c.x + 10, c.y - 7, c.w * 0.55, 10, 5);
      ctx.fill();
    });

    // 2. Linha do horizonte e textura do solo
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(w, GROUND_Y);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    this.groundDots.forEach((d) => {
      ctx.fillRect(d.x, GROUND_Y + d.yOffset, d.w, 2);
    });

    // 3. Obstáculos (Cactos)
    const nextObs = this.currentObservation?.nextObstacle;
    this.obstacles.forEach((obs) => {
      this.drawCactus(ctx, obs, obs === nextObs);
    });

    // 4. Linha de sensor até o próximo obstáculo
    if (nextObs && !this.dino.crashed) {
      const startX = this.dino.x + this.dino.width;
      const endX = Math.max(startX, nextObs.x);
      const lineY = GROUND_Y - 18;

      ctx.save();
      ctx.strokeStyle = '#1d4ed8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, lineY);
      ctx.lineTo(endX, lineY);
      ctx.stroke();
      ctx.restore();

      // Marcadores nas pontas
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(startX - 1, lineY - 4, 2, 8);
      ctx.fillRect(endX - 1, lineY - 4, 2, 8);

      // Rótulo de distância em pixels
      const distPx = Math.max(0, Math.round(endX - startX));
      if (endX - startX > 52) {
        const midX = (startX + endX) / 2;
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        const label = `${distPx} px`;
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillRect(midX - tw / 2, lineY - 21, tw, 16);
        ctx.fillStyle = '#1d4ed8';
        ctx.fillText(label, midX, lineY - 9);
      }
    }

    // 5. Dinossauro
    this.drawDino(ctx);

    // 6. Textos flutuantes de recompensa
    this.floatingTexts.forEach((ft) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.font = '700 14px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });

    // 7. HUD Didático no topo do Canvas
    this.drawCanvasHUD(ctx);
  }

  drawCactus(ctx, obs, isNext) {
    const { x, y, width, height, type } = obs;

    if (isNext) {
      ctx.save();
      ctx.strokeStyle = 'rgba(29, 78, 216, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x - 4, y - 4, width + 8, height + 6);
      ctx.restore();
    }

    ctx.fillStyle = type === 0 ? '#0f766e' : '#065f46';

    if (type === 0) {
      // Cacto simples (Baixo)
      const trunkW = 10;
      const trunkX = x + (width - trunkW) / 2;
      ctx.beginPath();
      ctx.roundRect(trunkX, y, trunkW, height, 4);
      ctx.roundRect(x, y + 10, 8, 5, 2);
      ctx.roundRect(x, y + 6, 5, 9, 2);
      ctx.roundRect(x + width - 8, y + 14, 8, 5, 2);
      ctx.roundRect(x + width - 5, y + 9, 5, 10, 2);
      ctx.fill();
    } else {
      // Cacto duplo alto (Alto)
      const t1 = x + 6;
      const t2 = x + 22;
      ctx.beginPath();
      ctx.roundRect(t1, y, 10, height, 4);
      ctx.roundRect(x, y + 14, 8, 5, 2);
      ctx.roundRect(x, y + 8, 5, 11, 2);

      ctx.roundRect(t2, y + 8, 10, height - 8, 4);
      ctx.roundRect(x + width - 8, y + 18, 8, 5, 2);
      ctx.roundRect(x + width - 5, y + 12, 5, 11, 2);
      ctx.fill();
    }
  }

  drawDino(ctx) {
    const { x, y, onGround, crashed, legPhase } = this.dino;
    const bodyColor = crashed ? '#dc2626' : '#0f172a';
    const accentColor = crashed ? '#fee2e2' : '#ffffff';

    ctx.fillStyle = bodyColor;

    // Cauda
    ctx.beginPath();
    ctx.moveTo(x, y + 20);
    ctx.lineTo(x + 10, y + 24);
    ctx.lineTo(x + 10, y + 32);
    ctx.lineTo(x + 2, y + 30);
    ctx.closePath();
    ctx.fill();

    // Tronco
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 16, 20, 19, 4);
    ctx.fill();

    // Pescoço e Cabeça
    ctx.beginPath();
    ctx.roundRect(x + 17, y, 21, 16, 4);
    ctx.fill();

    // Focinho / Mandíbula
    ctx.fillRect(x + 24, y + 13, 11, 4);

    // Braço curto
    ctx.fillRect(x + 27, y + 22, 6, 3);

    // Olho
    ctx.fillStyle = accentColor;
    if (crashed) {
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x + 23, y + 4);
      ctx.lineTo(x + 27, y + 8);
      ctx.moveTo(x + 27, y + 4);
      ctx.lineTo(x + 23, y + 8);
      ctx.stroke();
    } else {
      ctx.fillRect(x + 23, y + 4, 4, 4);
    }

    // Pernas animadas
    ctx.fillStyle = bodyColor;
    if (!onGround) {
      // Pose de salto
      ctx.fillRect(x + 12, y + 34, 5, 7);
      ctx.fillRect(x + 21, y + 33, 5, 6);
    } else {
      const step = Math.sin(legPhase) > 0;
      if (step) {
        ctx.fillRect(x + 12, y + 35, 5, 9);
        ctx.fillRect(x + 21, y + 35, 5, 5);
      } else {
        ctx.fillRect(x + 12, y + 35, 5, 5);
        ctx.fillRect(x + 21, y + 35, 5, 9);
      }
    }
  }

  drawCanvasHUD(ctx) {
    const obs = this.currentObservation || this.observe();
    const state = decodeState(obs.stateId);
    const actionName = ACTION_NAMES[this.lastAction];
    const isJump = this.lastAction === ACTION_JUMP;

    // Bloco esquerdo: Estado Atual
    ctx.font = '600 12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    const stateText = `${state.code} · ${state.summary}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(stateText, 16, 24);

    ctx.font = '500 11.5px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(
      `Velocidade: ${this.speed.toFixed(1)} px/frame · Obstáculo: ${state.obsLabel}`,
      16,
      42
    );

    // Bloco direito: Ação Atual e Pontuação
    ctx.textAlign = 'right';
    ctx.font = '700 12.5px "IBM Plex Mono", monospace';
    ctx.fillStyle = isJump ? '#d97706' : '#0284c7';
    ctx.fillText(`AÇÃO: ${isJump ? '▲ ' : '■ '}${actionName}`, CANVAS_W - 16, 24);

    ctx.font = '500 11.5px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`${this.lastDecisionMode} · Obstáculos: ${this.score}`, CANVAS_W - 16, 42);
  }
}
