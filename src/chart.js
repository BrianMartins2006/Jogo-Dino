/**
 * Gráfico em Canvas Puro para Curva de Aprendizagem (Pontuação e Média Móvel)
 */

export class LearningChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(scores) {
    const { canvas, ctx } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Fundo neutro
    ctx.fillStyle = '#fbfcfe';
    ctx.fillRect(0, 0, w, h);

    const pad = { top: 14, right: 16, bottom: 26, left: 42 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (!scores || scores.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '500 12.5px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Os primeiros episódios aparecerão aqui conforme o agente conclui tentativas.',
        w / 2,
        h / 2 + 4
      );
      return;
    }

    // Mostrar até os últimos 80 episódios para manter legibilidade
    const windowSlice = scores.slice(-80);
    const startEp = scores.length - windowSlice.length + 1;
    const maxScore = Math.max(5, ...windowSlice);
    const yMax = Math.ceil(maxScore / 5) * 5;

    // Linhas de grade horizontais
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const ratio = i / ticks;
      const y = pad.top + plotH - ratio * plotH;
      const val = Math.round(ratio * yMax);

      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();

      ctx.fillText(String(val), pad.left - 8, y + 4);
    }

    // Eixo X labels
    ctx.textAlign = 'left';
    ctx.fillText(`Ep. ${startEp}`, pad.left, h - 7);
    ctx.textAlign = 'right';
    ctx.fillText(`Ep. ${scores.length}`, pad.left + plotW, h - 7);

    const getX = (idx) => {
      if (windowSlice.length === 1) return pad.left + plotW / 2;
      return pad.left + (idx / (windowSlice.length - 1)) * plotW;
    };
    const getY = (val) => pad.top + plotH - (val / yMax) * plotH;

    // Linha da Pontuação Bruta
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    windowSlice.forEach((val, idx) => {
      const x = getX(idx);
      const y = getY(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Pontos de episódio
    ctx.fillStyle = '#0284c7';
    windowSlice.forEach((val, idx) => {
      const x = getX(idx);
      const y = getY(val);
      ctx.beginPath();
      ctx.arc(x, y, windowSlice.length > 45 ? 1.8 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Linha de Média Móvel (10 episódios)
    const movingAvg = windowSlice.map((_, idx) => {
      const episodeIndex = startEp - 1 + idx;
      const sliceStart = Math.max(0, episodeIndex - 9);
      const sub = scores.slice(sliceStart, episodeIndex + 1);
      return sub.reduce((a, b) => a + b, 0) / sub.length;
    });

    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    movingAvg.forEach((val, idx) => {
      const x = getX(idx);
      const y = getY(val);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
