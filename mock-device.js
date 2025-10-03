// mock-device.js
// จำลอง "หมอนลดกรน" เชื่อมต่อสำเร็จ + สร้างข้อมูลการนอนตามค่า settings
// ทำให้ใช้งานแบบ global ง่ายๆ: window.MockDevice

(function(global){
  const state = {
    connected: false,
    deviceId: 'PILLOW-DEM0-001',
    settings: {
      vibrationLevel: 60,   // 0-100
      travelMode: false,    // ลดแรงสั่นอัตโนมัติ
      snoreThreshold: 55    // เกณฑ์จับกรน (หน่วยสมมุติ)
    }
  };

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function mockConnect(){
    await sleep(300 + Math.random()*500);
    state.connected = true;
    return { connected: true, deviceId: state.deviceId };
  }

  function applySettings(s){
    state.settings = {...state.settings, ...s};
  }

  // ยูทิลสุ่มช่วงเวลา HH:mm
  function minutesToHHMM(m){
    const h = Math.floor(m/60).toString().padStart(2,'0');
    const mm = Math.floor(m%60).toString().padStart(2,'0');
    return `${h}:${mm}`;
  }

  // สูตรสุ่มอย่างสมเหตุผล:
  // - เวลานอนรวม: 360–480 นาที (6–8 ชม.) แกว่งตามแรงสั่น/โหมดเดินทางเล็กน้อย
  // - เกณฑ์จับกรนสูง -> จำนวน event ลด / intensity ต้องสูงกว่า threshold
  // - แรงสั่นสูง -> ลดความยาวกรน (สั้นลง) แต่ burst บ่อยขึ้น
  // - โหมดเดินทาง -> ลดแรงสั่น effective ~30%
  function generateNightData(dateStr){
    const { vibrationLevel, travelMode, snoreThreshold } = state.settings;
    const effVib = travelMode ? Math.max(0, vibrationLevel - 30) : vibrationLevel;

    const baseSleep = 360 + Math.round(Math.random()*120); // 360-480
    const vibAdj = Math.round((effVib - 50) * 0.6);         // +/- 30 นาที
    const totalSleepMinutes = Math.max(300, Math.min(540, baseSleep + vibAdj));

    // สุ่มจำนวนช่วงกรน โดย threshold สูง -> น้อยลง
    const baseEvents = 6 + Math.floor(Math.random()*8);     // 6-13
    const thrAdj = Math.round((snoreThreshold - 50) * 0.2); // +10 threshold -> -2 events
    const eventCount = Math.max(1, baseEvents - thrAdj);

    // กระจาย event ตลอดคืน
    const snoreEvents = [];
    let used = new Set();
    for(let i=0;i<eventCount;i++){
      let startMin;
      let tryCount=0;
      do{
        startMin = Math.floor(Math.random()*totalSleepMinutes);
        tryCount++;
        if (tryCount>50) break;
      } while(used.has(startMin));
      used.add(startMin);

      // intensity ขึ้นกับ threshold (ต้องสูงเกินถึงจะนับ)
      let intensity = Math.max(snoreThreshold+1, Math.round(35 + Math.random()*70));
      if (intensity>100) intensity=100;

      // ความยาวกรน: 2–10 นาที, ยิ่งแรงสั่นสูงยิ่งสั้นลง
      const baseDur = 2 + Math.floor(Math.random()*9);
      const vibCut = Math.round(effVib/25); // 0–4 นาที
      const dur = Math.max(1, baseDur - vibCut);

      const endMin = Math.min(totalSleepMinutes, startMin + dur);
      snoreEvents.push({
        start: minutesToHHMM(startMin),
        end: minutesToHHMM(endMin),
        intensity
      });
    }

    // vibration bursts: สร้างสัมพันธ์กับจำนวน event และ effVib
    const vibrationBursts = [];
    const bursts = Math.round(eventCount * (0.6 + effVib/70)); // ยิ่งแรงสั่นมาก ยิ่ง burst บ่อย
    for(let i=0;i<bursts;i++){
      const t = Math.floor(Math.random()*totalSleepMinutes);
      vibrationBursts.push({ time: minutesToHHMM(t), level: Math.min(100, effVib + Math.round(Math.random()*20)-10) });
    }

    // apnea flags: โอกาสเล็กน้อย (0–3 จุด)
    const apneaCount = Math.max(0, Math.floor((100-snoreThreshold)/35) + Math.floor(Math.random()*2) - (effVib>70?1:0));
    const apneaFlags = [];
    for(let i=0;i<apneaCount;i++){
      apneaFlags.push(minutesToHHMM(Math.floor(Math.random()*totalSleepMinutes)));
    }

    // sleep stages: แบ่งเป็นชิ้นๆ รวมแล้วเท่ากับ totalSleepMinutes
    // สัดส่วนคร่าวๆ: light ~50%, deep ~30%, rem ~20% (แกว่งนิดหน่อย)
    const light = Math.round(totalSleepMinutes * (0.45 + Math.random()*0.1));
    const deep  = Math.round(totalSleepMinutes * (0.25 + Math.random()*0.1));
    const rem   = Math.max(0, totalSleepMinutes - light - deep);
    const stages = [];
    let cur = 0;
    function pushStage(len, stage){
      if (len<=0) return;
      const start = minutesToHHMM(cur);
      const end   = minutesToHHMM(cur + len);
      stages.push({ start, end, stage });
      cur += len;
    }
    // ผสมลำดับเล็กน้อย
    const order = ['light','deep','rem'].sort(()=>Math.random()-.5);
    for(const s of order){
      if (s==='light') pushStage(light, 'light');
      if (s==='deep')  pushStage(deep,  'deep');
      if (s==='rem')   pushStage(rem,   'rem');
    }

    // คำนวณสกอร์ง่ายๆ: เริ่ม 100 - โทษจากกรน - โทษจาก apnea + โบนัสจาก effVib ปานกลาง
    const snoreMinutes = snoreEvents.reduce((acc,e)=>{
      const [sh,sm]=e.start.split(':').map(Number);
      const [eh,em]=e.end.split(':').map(Number);
      return acc + ((eh*60+em)-(sh*60+sm));
    },0);
    const penaltySnore = Math.min(40, Math.round(snoreMinutes/2));
    const penaltyApnea = apoptosis(apneaFlags.length);
    const vibBonus = effVib>=40 && effVib<=70 ? 6 : 0;
    let score = Math.max(0, Math.min(100, 100 - penaltySnore - penaltyApnea + vibBonus));

    return {
      date: dateStr,
      totalSleepMinutes,
      snoreEvents,
      vibrationBursts,
      apneaFlags,
      sleepStages: stages,
      score
    };
  }

  function apoptosis(n){ // โทษจาก apnea (ชื่อฟังก์ชันกวนๆเฉยๆ)
    if (n<=0) return 0;
    if (n===1) return 8;
    if (n===2) return 16;
    return 24;
  }

  global.MockDevice = {
    mockConnect,
    applySettings,
    generateNightData,
    _getState: ()=>({...state})
  };

})(window);
