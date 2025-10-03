// app.js
// === LocalStorage Keys ===
const LS_DATA = 'snoretrack:data:v1';
const LS_SETTINGS = 'snoretrack:settings:v1';

// === State (in-memory) ===
let allNights = [];  // array of day objects (newest -> oldest)
let settings = {
  vibrationLevel: 60,
  travelMode: false,
  snoreThreshold: 55
};

// ======= UTIL =======
const $ = (sel, root=document)=> root.querySelector(sel);
const $$ = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

function fmtHM(totalMin){
  const h = Math.floor(totalMin/60);
  const m = totalMin%60;
  return `${h}ชม ${m}นาที`;
}
function todayStr(d=new Date()){
  const y = d.getFullYear();
  const m = (d.getMonth()+1).toString().padStart(2,'0');
  const day = d.getDate().toString().padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateOffsetStr(offsetDays){
  const d = new Date(); d.setDate(d.getDate()+offsetDays);
  return todayStr(d);
}
function download(filename, content){
  const blob = new Blob([content], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(()=> URL.revokeObjectURL(url), 500);
}

// ======= DATA LAYER =======
function loadSettings(){
  const s = localStorage.getItem(LS_SETTINGS);
  if (s){
    try{ settings = {...settings, ...JSON.parse(s)}; }catch{}
  }
}
function saveSettings(){
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}

function loadData(){
  const s = localStorage.getItem(LS_DATA);
  if (!s){
    // สร้างข้อมูลจำลองย้อนหลัง 10 วัน
    const tmp = [];
    for(let i=0;i<10;i++){
      const ds = dateOffsetStr(-i);
      tmp.push(MockDevice.generateNightData(ds));
    }
    allNights = tmp;
    persistData();
  } else {
    try{
      const arr = JSON.parse(s);
      // เรียงใหม่จากใหม่->เก่า
      allNights = arr.sort((a,b)=> b.date.localeCompare(a.date));
    }catch{
      allNights = [];
    }
  }
}
function persistData(){
  // จัดเรียง & เขียนลง LS
  const sorted = [...allNights].sort((a,b)=> a.date.localeCompare(b.date)); // old->new
  localStorage.setItem(LS_DATA, JSON.stringify(sorted));
  // in-memory = new->old
  allNights = sorted.sort((a,b)=> b.date.localeCompare(a.date));
}
function getNight(dateStr){
  return allNights.find(n=> n.date===dateStr) || null;
}
function saveNight(data){
  const idx = allNights.findIndex(n=> n.date===data.date);
  if (idx>=0) allNights[idx] = data;
  else allNights.push(data);
  persistData();
}
function getAllNights(){ return allNights; }

function exportData(){
  const sorted = [...allNights].sort((a,b)=> a.date.localeCompare(b.date));
  return JSON.stringify(sorted, null, 2);
}
function importData(jsonText){
  const incoming = JSON.parse(jsonText);
  if (!Array.isArray(incoming)) throw new Error('รูปแบบไม่ถูกต้อง');
  for(const item of incoming){
    if (!item.date) continue;
    const current = getNight(item.date);
    // merge แบบไว้ค่าที่ใหม่กว่า (ถ้าเท่ากันก็แทนที่)
    if (!current || (current && item.score>=current.score)){
      saveNight(item);
    }
  }
}

// ======= NAV / VIEWS =======
const views = {
  today: $('#view-today'),
  logs: $('#view-logs'),
  charts: $('#view-charts'),
  settings: $('#view-settings')
};
const nav = $('.nav');
const indicator = $('.nav-indicator');
const navBtns = $$('.nav-btn');
const hamburgerBtn = $('#btnHamburger');
const mobileMenu = $('#mobileMenu');

function switchView(name){
  Object.keys(views).forEach(k=>{
    views[k].classList.toggle('active', k===name);
  });
  navBtns.forEach(btn=>{
    const is = btn.dataset.tab===name;
    btn.classList.toggle('active', is);
    if (is){
      moveIndicatorTo(btn);
    }
  });
  if (name==='charts'){ refreshChartsUI(); }
  if (name==='today'){ renderToday(); }
  if (name==='logs'){ renderLogs(); }
}

function moveIndicatorTo(btn){
  const navRect = $('.nav').getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const left = btnRect.left - navRect.left;
  const width = btnRect.width;
  
  document.documentElement.style.setProperty('--indicator-left', `${left}px`);
  document.documentElement.style.setProperty('--indicator-width', `${width}px`);
}

// ======= TODAY =======
function renderToday(){
  const today = getNight(todayStr());
  // ถ้าไม่มี ให้บอกว่า "ยังไม่มี สร้างข้อมูลจำลอง" แต่เพื่อความง่าย สร้างให้อัตโนมัติ
  if (!today){
    const d = MockDevice.generateNightData(todayStr());
    saveNight(d);
  }
  const t = getNight(todayStr());

  const total = t.totalSleepMinutes;
  const snoreMinutes = t.snoreEvents.reduce((acc,e)=>{
    const [sh,sm]=e.start.split(':').map(Number);
    const [eh,em]=e.end.split(':').map(Number);
    return acc + ((eh*60+em)-(sh*60+sm));
  },0);
  const snoreCount = t.snoreEvents.length;
  const apneaPct = Math.min(100, Math.round((t.apneaFlags.length*3)/ (total/60) * 10)); // คิดเล่นๆ
  $('#kpi-total').textContent = fmtHM(total);
  $('#kpi-snore-min').textContent = `${snoreMinutes} นาที`;
  $('#kpi-snore-count').textContent = `${snoreCount} ครั้ง`;
  $('#kpi-apnea-pct').textContent = `${apneaPct}%`;
  $('#kpi-score').textContent = `คะแนน: ${t.score}`;

  // mini 7-day avg
  const last7 = getAllNights().slice(0,7);
  if (last7.length){
    const avgTotal = Math.round(last7.reduce((s,n)=> s+n.totalSleepMinutes,0)/last7.length);
    const avgSnore = Math.round(last7.reduce((s,n)=>{
      return s + n.snoreEvents.reduce((acc,e)=>{
        const [sh,sm]=e.start.split(':').map(Number);
        const [eh,em]=e.end.split(':').map(Number);
        return acc + ((eh*60+em)-(sh*60+sm));
      },0);
    },0)/last7.length);
    $('#kpi-total-avg').textContent = `เทียบ 7 วัน: ${fmtHM(avgTotal)}`;
    $('#kpi-snore-avg').textContent = `เทียบ 7 วัน: ${avgSnore} นาที`;
    $('#kpi-snore-count-avg').textContent = `—`; // ไม่โชว์เพิ่ม
  }

  // detail
  const detail = [
    `วันที่: ${t.date}`,
    `ช่วงเวลาที่กรน: ${t.snoreEvents.map(e=>`${e.start}-${e.end} (${e.intensity})`).join(', ') || '—'}`,
    `Apnea flags: ${t.apneaFlags.join(', ') || '—'}`,
    `Vibration bursts: ${t.vibrationBursts.length} ครั้ง`,
    `Stages: ${t.sleepStages.map(s=>`${s.stage} ${s.start}-${s.end}`).join(', ')}`
  ].join('\n');
  $('#todayDetail').textContent = detail;
}

$('#btnSimulateTonight').addEventListener('click', ()=>{
  const d = MockDevice.generateNightData(todayStr());
  saveNight(d);
  renderToday();
  toast('สร้างข้อมูลคืนนี้ (จำลอง) แล้ว!');
});

// ======= LOGS =======
const logsList = $('#logsList');
let logsRange = 'all';

function renderLogs(){
  const all = getAllNights(); // new->old
  let show = all;
  if (logsRange==='today'){
    show = all.filter(n=> n.date===todayStr());
  } else if (logsRange==='7'){
    const start = dateOffsetStr(-6);
    show = all.filter(n=> n.date>=start);
  } else if (logsRange==='30'){
    const start = dateOffsetStr(-29);
    show = all.filter(n=> n.date>=start);
  }

  logsList.innerHTML = '';
  for(const n of show){
    const snoreMinutes = n.snoreEvents.reduce((acc,e)=>{
      const [sh,sm]=e.start.split(':').map(Number);
      const [eh,em]=e.end.split(':').map(Number);
      return acc + ((eh*60+em)-(sh*60+sm));
    },0);
    const item = document.createElement('div');
    item.className = 'day-item';
    item.innerHTML = `
      <div class="day-head" role="button" tabindex="0">
        <div class="date">${n.date}</div>
        <div class="meta">
          <span>นอนรวม: <b>${fmtHM(n.totalSleepMinutes)}</b></span>
          <span>กรน: <b>${snoreMinutes} นาที</b></span>
          <span>คะแนน: <b>${n.score}</b></span>
          <button class="btn btnOpenChart" data-date="${n.date}">ดูกราฟ</button>
        </div>
      </div>
      <div class="day-body">
        <pre>${JSON.stringify({
          snoreEvents: n.snoreEvents.slice(0,8),
          apneaFlags: n.apneaFlags,
          vibrationBursts: n.vibrationBursts.slice(0,10)
        }, null, 2)}</pre>
      </div>
    `;
    const head = $('.day-head', item);
    const body = $('.day-body', item);
    head.addEventListener('click', ()=>{
      item.classList.toggle('open');
    });
    $('.btnOpenChart', item).addEventListener('click', (e)=>{
      e.stopPropagation();
      // ไปหน้า charts พร้อมเลือกวัน
      switchView('charts');
      $('#chartDateSelect').value = n.date;
      refreshChartsUI();
    });
    logsList.appendChild(item);
  }
}

$('.filter-tabs').addEventListener('click', (e)=>{
  const btn = e.target.closest('.filter-tab');
  if (!btn) return;
  $$('.filter-tab').forEach(c=> c.classList.remove('active'));
  btn.classList.add('active');
  logsRange = btn.dataset.range;
  renderLogs();
});

$('#btnShowExport')?.addEventListener('click', ()=>{
  download('snoretrack-data.json', exportData());
});
$('#importFile')?.addEventListener('change', async(e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try{
    importData(text);
    toast('นำเข้าข้อมูลสำเร็จ');
    renderLogs();
    refreshChartsUI();
  }catch(err){
    toast('ไฟล์ไม่ถูกต้อง', true);
    console.error(err);
  }finally{
    e.target.value = '';
  }
});

// ======= CHARTS =======
let lineChart, barChart, donutChart;

function buildChartDataFor(dateStr){
  const n = getNight(dateStr) || getAllNights()[0];
  if (!n) return null;

  // สร้าง 24 จุด นาทีกรนต่อชั่วโมง
  const snorePerHour = new Array(24).fill(0);
  for(const e of n.snoreEvents){
    const [sh,sm]=e.start.split(':').map(Number);
    const [eh,em]=e.end.split(':').map(Number);
    const sMin = sh*60+sm, eMin=eh*60+em;
    for(let m=sMin; m<eMin; m++){
      const hour = Math.floor(m/60);
      snorePerHour[hour] += 1; // 1 นาที
    }
  }

  // bin 30 นาที (48 ช่อง)
  const bins = new Array(48).fill(0);
  for(const e of n.snoreEvents){
    const [sh,sm]=e.start.split(':').map(Number);
    const [eh,em]=e.end.split(':').map(Number);
    const sMin = sh*60+sm, eMin=eh*60+em;
    for(let m=sMin; m<eMin; m++){
      const bin = Math.floor(m/30);
      bins[bin] += 1;
    }
  }

  // stages %
  const stages = {light:0, deep:0, rem:0};
  for(const s of n.sleepStages){
    const [sh,sm]=s.start.split(':').map(Number);
    const [eh,em]=s.end.split(':').map(Number);
    const dur = (eh*60+em)-(sh*60+sm);
    stages[s.stage]+= dur;
  }
  const total = n.totalSleepMinutes || 1;
  const stagePct = [
    Math.round(stages.light*100/total),
    Math.round(stages.deep*100/total),
    Math.round(stages.rem*100/total)
  ];

  return { n, snorePerHour, bins, stagePct };
}

function refreshChartsUI(){
  const sel = $('#chartDateSelect');
  // fill options (new->old)
  const nights = getAllNights();
  sel.innerHTML = nights.map(n=> `<option value="${n.date}">${n.date}</option>`).join('');
  if (!sel.value && nights[0]) sel.value = nights[0].date;

  const picked = sel.value || (nights[0]?.date);
  drawCharts(picked);
}

$('#chartDateSelect').addEventListener('change', ()=>{
  drawCharts($('#chartDateSelect').value);
});

function drawCharts(dateStr){
  const data = buildChartDataFor(dateStr);
  if (!data) return;

  const ctxLine = $('#lineSnorePerHour').getContext('2d');
  const ctxBar  = $('#barSnoreBins').getContext('2d');
  const ctxDon  = $('#donutStages').getContext('2d');

  // destroy old
  lineChart?.destroy();
  barChart?.destroy();
  donutChart?.destroy();

  // กราฟเส้น
  lineChart = new Chart(ctxLine, {
    type: 'line',
    data: {
      labels: Array.from({length:24}, (_,i)=> `${i}:00`),
      datasets: [{
        label: 'นาทีที่กรนต่อชั่วโมง',
        data: data.snorePerHour,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        tension: 0.35,
        fill: true,
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeInOutQuart' },
      plugins: {
        legend: { 
          labels: { 
            color: '#374151',
            font: { family: 'Inter', size: 14 }
          } 
        }
      },
      scales: {
        x: { 
          ticks: { color: '#6b7280', font: { family: 'Inter' } }, 
          grid: { color: '#e5e7eb' },
          border: { color: '#d1d5db' }
        },
        y: { 
          ticks: { color: '#6b7280', font: { family: 'Inter' } }, 
          grid: { color: '#e5e7eb' },
          border: { color: '#d1d5db' }
        }
      }
    }
  });

  // กราฟแท่ง
  barChart = new Chart(ctxBar, {
    type: 'bar',
    data: {
      labels: Array.from({length:48}, (_,i)=> `${String(Math.floor(i/2)).padStart(2,'0')}:${i%2===0?'00':'30'}`),
      datasets: [{
        label: 'ความถี่การกรน (ต่อนาทีในแต่ละ bin)',
        data: data.bins,
        backgroundColor: 'rgba(37, 99, 235, 0.8)',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend: { 
          labels: { 
            color: '#374151',
            font: { family: 'Inter', size: 14 }
          } 
        }
      },
      scales: {
        x: { 
          ticks: { 
            maxRotation: 45, 
            minRotation: 45, 
            color: '#6b7280',
            font: { family: 'Inter', size: 11 }
          }, 
          grid: { color: '#e5e7eb' },
          border: { color: '#d1d5db' }
        },
        y: { 
          ticks: { color: '#6b7280', font: { family: 'Inter' } }, 
          grid: { color: '#e5e7eb' },
          border: { color: '#d1d5db' }
        }
      }
    }
  });

  // โดนัท
  donutChart = new Chart(ctxDon, {
    type: 'doughnut',
    data: {
      labels: ['Light Sleep', 'Deep Sleep', 'REM Sleep'],
      datasets: [{
        data: data.stagePct,
        backgroundColor: [
          '#3b82f6',  // blue-500
          '#1d4ed8',  // blue-700
          '#60a5fa'   // blue-400
        ],
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { animateScale: true, animateRotate: true, duration: 1000 },
      plugins: {
        legend: { 
          position: 'bottom',
          labels: { 
            color: '#374151',
            font: { family: 'Inter', size: 14 },
            padding: 20,
            usePointStyle: true,
            pointStyle: 'circle'
          } 
        }
      },
      cutout: '65%'
    }
  });
}

$('#btnSaveCharts').addEventListener('click', ()=>{
  // รวม 3 แคนวาสต่อกันเป็นไฟล์เดียว (ง่าย: บันทึกทีละรูป)
  const canvases = [$('#lineSnorePerHour'), $('#barSnoreBins'), $('#donutStages')];
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  canvases.forEach((c,i)=>{
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `charts-${stamp}-${i+1}.png`;
    a.click();
  });
});

// ======= SETTINGS =======
const vibRange = $('#vibrationLevel');
const vibValue = $('#vibrationValue');
const travelMode = $('#travelMode');
const snoreThreshold = $('#snoreThreshold');

function loadSettingsToUI(){
  vibRange.value = settings.vibrationLevel;
  vibValue.textContent = settings.vibrationLevel;
  travelMode.checked = settings.travelMode;
  snoreThreshold.value = settings.snoreThreshold;
}
vibRange.addEventListener('input', ()=>{
  vibValue.textContent = vibRange.value;
});

$('#btnSaveSettings').addEventListener('click', ()=>{
  settings.vibrationLevel = parseInt(vibRange.value,10);
  settings.travelMode = travelMode.checked;
  settings.snoreThreshold = parseInt(snoreThreshold.value,10) || 55;
  saveSettings();
  MockDevice.applySettings(settings);
  toast('บันทึกการตั้งค่าแล้ว');
});
$('#btnResetSettings').addEventListener('click', ()=>{
  settings = { vibrationLevel:60, travelMode:false, snoreThreshold:55 };
  saveSettings();
  MockDevice.applySettings(settings);
  loadSettingsToUI();
  toast('คืนค่าเริ่มต้นแล้ว');
});

// ======= TOAST =======
let toastTimer=null;
function toast(msg, isError=false){
  const el = $('#toast');
  el.textContent = msg;
  el.style.background = isError
    ? '#ef4444'  // red-500
    : '#2563eb'; // blue-600
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 3000);
}

// ======= NAV EVENTS =======
navBtns.forEach(b=>{
  b.addEventListener('click', ()=>{
    switchView(b.dataset.tab);
  });
});
window.addEventListener('resize', ()=>{
  const active = $('.nav-btn.active');
  if (active) moveIndicatorTo(active);
});

// ======= MOBILE NAV (HAMBURGER) =======
if (hamburgerBtn && mobileMenu){
  function setHamburgerOpen(open){
    if (open){
      mobileMenu.removeAttribute('hidden');
      hamburgerBtn.setAttribute('aria-expanded','true');
      const use = hamburgerBtn.querySelector('use');
      if (use) use.setAttribute('href', '#icon-close');
    } else {
      mobileMenu.setAttribute('hidden','');
      hamburgerBtn.setAttribute('aria-expanded','false');
      const use = hamburgerBtn.querySelector('use');
      if (use) use.setAttribute('href', '#icon-menu');
    }
  }

  hamburgerBtn.addEventListener('click', ()=>{
    const open = mobileMenu.hasAttribute('hidden');
    setHamburgerOpen(open);
  });
  mobileMenu.addEventListener('click', (e)=>{
    const btn = e.target.closest('.mobile-item');
    if (!btn) return;
    const tab = btn.dataset.tab;
    switchView(tab);
    setHamburgerOpen(false);
  });

  // click outside to close
  document.addEventListener('click', (e)=>{
    if (!mobileMenu || !hamburgerBtn) return;
    const isInside = e.target.closest('.mobile-menu') || e.target.closest('#btnHamburger');
    if (!isInside && !mobileMenu.hasAttribute('hidden')){
      setHamburgerOpen(false);
    }
  });
  // Escape to close
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && !mobileMenu.hasAttribute('hidden')){
      setHamburgerOpen(false);
    }
  });
  
  // Initially ensure menu is hidden
  setHamburgerOpen(false);
}

// ======= INIT =======
(async function init(){
  // โหลด settings + apply
  loadSettings();
  MockDevice.applySettings(settings);

  // Connect (mock)
  const res = await MockDevice.mockConnect();
  if (res.connected){
    // โหลดข้อมูล
    loadData();
    // init UI
    loadSettingsToUI();
    renderToday();
    renderLogs();
    refreshChartsUI();

    // ตั้งค่า nav indicator เริ่มต้น
    const active = $('.nav-btn.active');
    if (active){
      setTimeout(()=> moveIndicatorTo(active), 10);
    }
  } else {
    toast('เชื่อมต่ออุปกรณ์ไม่สำเร็จ', true);
  }
})();
