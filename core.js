/* core.js — lógica pura (sin DOM): filtro, sensores, modelos, estadística, CSV */
const Lab = {
  CAL: 5, // muestras de aire limpio para calibrar R0
  CONST: {
    VREF: 5, ADC_MAX: 1023, CLEAN_RATIO: 9.83, // Rs/R0 en aire limpio (datasheet MQ-2)
    // ppm = a · (Rs/R0)^b  — ajuste de las curvas log-log del datasheet (valores aproximados)
    GAS: { glp: { a: 574.25, b: -2.222 }, humo: { a: 3616.1, b: -2.675 }, h2: { a: 987.99, b: -2.162 } }
  }
};

/* Filtro digital: y[n] = (x[n] + … + x[n-4]) / 5 */
Lab.MovingAvg = class {
  constructor(n = 5) { this.n = n; this.buf = []; }
  push(x) {
    this.buf.push(x);
    if (this.buf.length > this.n) this.buf.shift();
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
  reset() { this.buf = []; }
};

/* Conversión de señales */
Lab.Sensors = {
  volts: adc => adc * Lab.CONST.VREF / Lab.CONST.ADC_MAX,
  // Rs = RL·(Vc − Vout)/Vout
  rs(adc, RL) { const v = Math.max(this.volts(adc), 0.001); return RL * (Lab.CONST.VREF - v) / v; },
  // R0 desde muestras en aire limpio
  r0(rsList) { return rsList.reduce((a, b) => a + b, 0) / rsList.length / Lab.CONST.CLEAN_RATIO; },
  ppm(rs, r0, gas) { const g = Lab.CONST.GAS[gas]; return g.a * Math.pow(rs / r0, g.b); },
  // TMP36: T(°C) = (Vout − 0.5)·100
  tempC(adc) { return (this.volts(adc) - 0.5) * 100; }
};

/* Modelo teórico analítico */
Lab.Models = {
  C: (t, p) => p.Cmax * (1 - Math.exp(-t / p.tauC)),
  T: (t, p) => p.Tamb + (p.Tmax - p.Tamb) * (1 - Math.exp(-t / p.tauT))
};

/* Estadística */
Lab.Stats = {
  mean: a => a.reduce((x, y) => x + y, 0) / a.length,
  std(a) { if (a.length < 2) return 0; const m = this.mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); },
  // Er% punto a punto; omite Xteo = 0
  erSeries: (exp, teo) => exp.reduce((o, x, i) => (teo[i] ? o.concat(Math.abs((x - teo[i]) / teo[i]) * 100) : o), [])
};

/* CSV: Tiempo, Vraw, Cexp, Texp, Cfil, Tfil, Cteo, Tteo */
Lab.CSV = {
  build(rows) {
    const h = 't_s,V_raw_V,C_exp_ppm,T_exp_C,C_fil_ppm,T_fil_C,C_teo_ppm,T_teo_C';
    return [h, ...rows.map(r => [r.t, r.vraw.toFixed(4), r.Cexp.toFixed(2), r.Texp.toFixed(2), r.Cfil.toFixed(2), r.Tfil.toFixed(2), r.Cteo.toFixed(2), r.Tteo.toFixed(2)].join(','))].join('\n');
  },
  download(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
};
