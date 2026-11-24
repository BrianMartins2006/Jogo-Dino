const melody = [45, 52, 57, 55, 45, 48, 53, 52, 41, 48, 53, 55, 43, 50, 55, 51];
const beat = 0.28;
let context;
let timer;
let output;
let nextNote;
let step;

function playNote(midi, type, volume, start, duration) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  envelope.gain.setValueAtTime(0.001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + 0.035);
  envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(envelope).connect(output);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

function schedule() {
  if (nextNote < context.currentTime) nextNote = context.currentTime + 0.03;
  while (nextNote < context.currentTime + 0.18) {
    const note = melody[step % melody.length];
    playNote(note, 'triangle', 0.13, nextNote, beat * 1.15);
    if (step % 4 === 0) playNote(note - 12, 'sine', 0.22, nextNote, beat * 3.9);
    step += 1;
    nextNote += beat;
  }
}

export async function startMusic() {
  context ??= new AudioContext();
  await context.resume();
  output = context.createGain();
  output.gain.value = 0.26;
  output.connect(context.destination);
  step = 0;
  nextNote = context.currentTime + 0.03;
  schedule();
  timer = setInterval(schedule, 80);
}

export function stopMusic() {
  clearInterval(timer);
  output.disconnect();
}
