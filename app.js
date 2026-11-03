/* app.js — interfaz, estado del ensayo y gráficos */
(() => {
  const { Sensors, Models, Stats, MovingAvg, CSV } = Lab;
  const $ = id => document.getElementById(id);
  const st = { src: null, running: false, n: 0, Ro: null, cal: [], rows: [], p: null, last: null, lastRx: 0, firstAlert: null };
  const maC = new MovingAvg(5), maT = new MovingAvg(5);

  const cfg = () => ({
    vol: +$('vol').value, volU: $('volU').value, Tamb: +$('tamb').value, Tmax: +$('tmax').value,
    tauT: +$('tauT').value, Cmax: +$('cmax').value, tauC: +$('tauC').value, dur: +$('dur').value,
    thr: +$('thr').value, gas: $('gas').value, RL: +$('rl').value, unit: $('unit').value
  });
  const dT = (c, u) => (u === 'K' ? c + 273.15 : c);
  const uLabel = u => (u === 'K' ? 'K' : '°C');

  /* ---------- Navegación ---------- */
  function show(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  }
  $('nav').addEventListener('click', e => { if (e.target.dataset.view) show(e.target.dataset.view); });

  /* ---------- Gráficos ---------- */
  const mk = (id, y, sets) => new Chart($(id), {
    type: 'line',
    data: { datasets: sets.map(s => ({ borderWidth: 2, pointRadius: 0, tension: 0.2, data: [], ...s })) },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      plugins: { legend: { labels: { boxWidth: 12, usePointStyle: true } } },
      scales: { x: { type: 'linear', title: { display: true, text: 't (s)' }, grid: { display: false } }, y: { title: { display: true, text: y } } }
    }
  });
  const raw = { label: 'Crudo', borderColor: '#c3d2ee', borderWidth: 1.5 };
  const fil = { label: 'Filtrado (media móvil, 5)', borderColor: '#2563eb' };
  const exp = { label: 'Experimental (filtrada)', borderColor: '#2563eb' };
  const teo = { label: 'Teórica', borderColor: '#7a8aa3', borderDash: [6, 4] };
  const chC = mk('chC', 'ppm', [raw, fil]), chT = mk('chT', '°C', [raw, fil]);
  const rsC = mk('rsC', 'ppm', [exp, teo]), rsT = mk('rsT', '°C', [exp, teo]);

  /* ---------- Conexión ---------- */
  function setConn(on) {
    $('btnConn').textContent = on ? 'Desconectar' : 'Conectar';
    $('chip').textContent = on ? ($('source').value === 'sim' ? 'Simulador activo' : 'Arduino conectado') : 'Sin fuente de datos';
    $('chip').classList.toggle('ok', on);
    $('source').disabled = $('speed').disabled = on;
    if (!on) { diag('T', null); diag('G', null); }
  }
  $('btnConn').onclick = async () => {
    if (st.src) { if (st.running) finish(); await st.src.stop(); st.src = null; setConn(false); return; }
    const s = $('source').value === 'sim' ? new Lab.SimSource(cfg, +$('speed').value) : new Lab.SerialSource();
    try { await s.start(onLine, () => { st.src = null; setConn(false); }); st.src = s; setConn(true); }
    catch (e) { alert('No se pudo conectar: ' + e.message); }
  };

  /* ---------- Diagnóstico de sensores ---------- */
  function diag(k, ok, msg) {
    $('dot' + k).className = 'dot' + (ok === null ? '' : ok ? ' ok' : ' bad');
    $('st' + k).textContent = ok === null ? 'Sin señal' : msg;
  }
  setInterval(() => { if (st.src && Date.now() - st.lastRx > 3000 + 1000 / (+$('speed').value || 1)) { diag('T', null); diag('G', null); } }, 1000);

  /* ---------- Pipeline de datos ---------- */
  function onLine(line) {
    let j; try { j = JSON.parse(line); } catch { return; }
    if (typeof j.temperatura !== 'number' || typeof j.nivel_gases_contaminantes !== 'number') return;
    st.lastRx = Date.now();
    const adcG = j.nivel_gases_contaminantes, Tc = j.temperatura;
    diag('T', Tc > -40 && Tc < 125, Tc > -40 && Tc < 125 ? `OK · ${Tc.toFixed(1)} °C` : 'Fuera de rango / desconectado');
    diag('G', adcG > 1 && adcG < 1022, adcG > 1 && adcG < 1022 ? `OK · ADC ${adcG.toFixed(0)}` : 'Saturado / desconectado');
    if (st.running) process(Tc, adcG);
  }

  function process(Tc, adcG) {
    const p = st.p;
    st.n++;
    if (st.n <= Lab.CAL) { // fase de calibración en aire limpio
      st.cal.push(Sensors.rs(adcG, p.RL)); maT.push(Tc);
      $('phase').textContent = `Calibrando R₀ en aire limpio (${st.n}/${Lab.CAL})`;
      if (st.n === Lab.CAL) { st.Ro = Sensors.r0(st.cal); $('phase').textContent = 'Ensayo en curso'; }
      return;
    }
    const t = st.n - Lab.CAL;
    const Cexp = Sensors.ppm(Sensors.rs(adcG, p.RL), st.Ro, p.gas);
    const row = {
      t, vraw: Sensors.volts(adcG), Cexp, Texp: Tc, Cfil: maC.push(Cexp), Tfil: maT.push(Tc),
      Cteo: Models.C(t, p), Tteo: Models.T(t, p)
    };
    st.rows.push(row);
    if (st.firstAlert === null && row.Cfil > p.thr) st.firstAlert = t;
    $('clock').textContent = t;
    $('kC').textContent = row.Cfil.toFixed(0);
    $('kT').textContent = dT(row.Tfil, p.unit).toFixed(1);
    const bad = row.Cfil > p.thr;
    $('kE').textContent = bad ? 'Alerta de contaminación' : 'Aire no contaminado'; $('kE').className = bad ? 'bad' : '';
    chC.data.datasets[0].data.push({ x: t, y: row.Cexp }); chC.data.datasets[1].data.push({ x: t, y: row.Cfil });
    chT.data.datasets[0].data.push({ x: t, y: dT(row.Texp, p.unit) }); chT.data.datasets[1].data.push({ x: t, y: dT(row.Tfil, p.unit) });
    chC.update('none'); chT.update('none');
    if (t >= p.dur) finish();
  }

  /* ---------- Ciclo del ensayo ---------- */
  function setRun(on) {
    st.running = on;
    $('btnRun').textContent = on ? 'Detener ensayo' : 'Iniciar ensayo';
    $('btnRun').classList.toggle('stop', on);
    if (st.src && st.src.arm) st.src.arm(on);
  }
  $('btnRun').onclick = () => {
    if (st.running) { finish(); return; }
    if (!st.src) { alert('Conecta primero una fuente de datos en Configuración.'); show('setup'); return; }
    st.p = cfg(); st.n = 0; st.cal = []; st.Ro = null; st.rows = []; st.firstAlert = null;
    maC.reset(); maT.reset();
    [chC, chT].forEach(c => c.data.datasets.forEach(d => (d.data = [])));
    chT.options.scales.y.title.text = uLabel(st.p.unit); $('kT').nextElementSibling.textContent = uLabel(st.p.unit);
    $('clock').textContent = 0; $('kC').textContent = $('kT').textContent = '—'; $('kE').textContent = '—'; $('kE').className = '';
    $('phase').textContent = 'Iniciando…';
    setRun(true);
  };
  function finish() {
    setRun(false);
    $('phase').textContent = 'Ensayo finalizado';
    if (st.rows.length < 5) { $('phase').textContent = 'Ensayo detenido (datos insuficientes)'; return; }
    st.last = { rows: st.rows.slice(), p: st.p, alert: st.firstAlert };
    renderResults(); show('results');
  }

  /* ---------- Resultados ---------- */
  function renderResults() {
    const { rows, p, alert: al } = st.last, u = p.unit;
    rsC.data.datasets[0].data = rows.map(r => ({ x: r.t, y: r.Cfil }));
    rsC.data.datasets[1].data = rows.map(r => ({ x: r.t, y: r.Cteo }));
    rsT.data.datasets[0].data = rows.map(r => ({ x: r.t, y: dT(r.Tfil, u) }));
    rsT.data.datasets[1].data = rows.map(r => ({ x: r.t, y: dT(r.Tteo, u) }));
    rsT.options.scales.y.title.text = uLabel(u);
    rsC.update(); rsT.update();

    const row = (name, unit, x, xt, k) => {
      const e = Stats.erSeries(x.map(v => v + k), xt.map(v => v + k));
      return `<tr><td>${name}</td><td>${x.length}</td><td>${Stats.mean(x).toFixed(2)} ${unit}</td><td>${Stats.std(x).toFixed(2)} ${unit}</td><td>${e.length ? Stats.mean(e).toFixed(2) : '—'} %</td><td>${e.length ? Math.max(...e).toFixed(2) : '—'} %</td></tr>`;
    };
    const k = 273.15; // Er% de temperatura siempre en kelvin (evita dividir por ~0 °C)
    const tShow = rows.map(r => dT(r.Tfil, u));
    $('statsBody').innerHTML =
      row('Gas C (filtrada)', 'ppm', rows.map(r => r.Cfil), rows.map(r => r.Cteo), 0) +
      row('Temperatura T (filtrada)', uLabel(u), tShow, rows.map(r => dT(r.Tteo, u)), u === 'K' ? 0 : k);
    $('resInfo').textContent = `Gas: ${p.gas.toUpperCase()} · Volumen: ${p.vol} ${p.volU} · R₀ calibrado: ${st.Ro.toFixed(2)} kΩ · ` +
      (al !== null ? `Primera alerta a los ${al} s (umbral ${p.thr} ppm).` : `Sin alerta (umbral ${p.thr} ppm).`);
    $('btnCsv').disabled = false;
  }
  $('btnCsv').onclick = () => st.last && CSV.download(CSV.build(st.last.rows), 'telelol_ensayo.csv');
})();
