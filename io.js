/* io.js — fuentes de datos. Ambas entregan líneas JSON a 1 Hz mediante callback(line). */

/* Arduino real vía Web Serial API */
Lab.SerialSource = class {
  async start(onLine, onClose) {
    if (!('serial' in navigator)) throw new Error('Web Serial no disponible. Usa Chrome o Edge.');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 9600 });
    const dec = new TextDecoderStream();
    this.piped = this.port.readable.pipeTo(dec.writable).catch(() => {});
    this.reader = dec.readable.getReader();
    (async () => {
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (line) onLine(line);
          }
        }
      } catch (e) { /* puerto desconectado */ }
      if (onClose) onClose();
    })();
  }
  async stop() {
    try { await this.reader.cancel(); await this.piped; await this.port.close(); } catch (e) {}
  }
};

/* Arduino virtual: genera lecturas crudas (con ruido ADC) a partir del modelo teórico.
   Los primeros Lab.CAL segundos tras arm(true) son aire limpio (calibración de R0). */
Lab.SimSource = class {
  constructor(getParams, speed = 1) { this.get = getParams; this.speed = speed; this.k = 0; this.armed = false; this.R0_TRUE = 20; }
  arm(on) { this.armed = on; this.k = 0; }
  async start(onLine) { this.h = setInterval(() => onLine(this.line()), 1000 / this.speed); }
  async stop() { clearInterval(this.h); }
  noise(a) { return (Math.random() + Math.random() + Math.random() - 1.5) * a; }
  line() {
    const p = this.get(), t = Math.max(0, this.k - Lab.CAL);
    if (this.armed) this.k++;
    const T = Lab.Models.T(t, p), C = Lab.Models.C(t, p), g = Lab.CONST.GAS[p.gas];
    const ratio = C > 0 ? Math.min(Lab.CONST.CLEAN_RATIO, Math.pow(C / g.a, 1 / g.b)) : Lab.CONST.CLEAN_RATIO;
    const vGas = 5 * p.RL / (ratio * this.R0_TRUE + p.RL);
    const adcG = Math.max(0, Math.min(1023, vGas * 1023 / 5 + this.noise(1.5)));
    const adcT = (T / 100 + 0.5) * 1023 / 5 + this.noise(1.2);
    return JSON.stringify({ temperatura: +Lab.Sensors.tempC(adcT).toFixed(2), nivel_gases_contaminantes: +adcG.toFixed(1) });
  }
};
