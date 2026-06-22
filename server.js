const readline = require('readline');
const { exec } = require('child_process');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

const IRCTC_HEADERS = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.0",
  "bmirak": "webbm",
  "bmiyek": "1EC176CEB44BD457C798CB96334EA393",
  "content-language": "en",
  "content-type": "application/json; charset=UTF-8",
  "greq": "1781783153801:91294f78-3efb-4900-8964-38a8910baf6c",
  "sec-ch-ua": "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\""
};



const parseDate = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
const formatDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const delay = ms => new Promise(r => setTimeout(r, ms));

const isConfirmed = (status) => {
  if (!status) return false;
  const s = status.toUpperCase().trim();

  return (
    (s.includes('AVAILABLE') && !s.includes('NOT AVAILABLE')) ||
    s.includes('CURR_AV') ||
    s.includes('RAC')
  );
};

const isMajorStation = (name) => {
  return name.includes('Jn') || name.includes('Central') || name.includes('City') || name.includes('Cantt');
};

const filterSpecialTrains = (trainList) => {
  if (!trainList) return [];
  return trainList.filter(t => {
    const no = t.trainNumber || "";
    const name = t.trainName || "";
    const isSpecial = no.startsWith('0') || name.toUpperCase().includes('SPL') || name.toUpperCase().includes('SPECIAL');
    return !isSpecial;
  });
};



let apiCallCount = 0;

const getTrainsBetweenStations = async (src, dest, date, quota) => {
  apiCallCount++;
  try {
    const res = await fetch("https://www.irctc.co.in/eticketing/protected/mapps1/altAvlEnq/TC", {
      headers: IRCTC_HEADERS,
      referrer: "https://www.irctc.co.in/nget/booking/train-list",
      body: JSON.stringify({
        concessionBooking: false, srcStn: src, destStn: dest, jrnyClass: "",
        jrnyDate: date, quotaCode: quota, currentBooking: "false", flexiFlag: false,
        handicapFlag: false, ticketType: "E", loyaltyRedemptionBooking: false, ftBooking: false
      }),
      method: "POST", mode: "cors", credentials: "omit"
    });
    const data = await res.json();
    return data.trainBtwnStnsList || [];
  } catch (err) { return []; }
};

const getRoute = async (trainNo) => {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
    const trainRes = await fetch(`https://erail.in/rail/getTrains.aspx?TrainNo=${trainNo}&DataSource=0&Language=0&Cache=true`, { headers });
    if (!trainRes.ok) return null;
    const trainText = await trainRes.text();

    const data = trainText.split("~~~~~~~~");
    if (
      !data[0] ||
      data[0].includes("Please try again after some time.") ||
      data[0].includes("Train not found")
    ) {
      return null;
    }

    if (data.length < 2) return null;

    const data1 = data[1].split("~").filter(el => el !== "");
    const trainId = data1[12];
    if (!trainId) return null;

    const routeUrl = `https://erail.in/data.aspx?Action=TRAINROUTE&Password=2012&Data1=${trainId}&Data2=0&Cache=true`;
    const routeRes = await fetch(routeUrl, { headers });
    if (!routeRes.ok) return null;
    const routeText = await routeRes.text();

    const routeData = routeText.split("~^");
    const arr = [];
    for (let i = 0; i < routeData.length; i++) {
      const data1 = routeData[i].split("~").filter(el => el !== "");
      if (data1.length < 8) continue;
      arr.push({
        source_stn_code: data1[1],
        source_stn_name: data1[2],
        arrive: data1[3],
        depart: data1[4],
        distance: data1[6],
        day: data1[7],
        zone: data1[9]
      });
    }
    return arr;
  } catch (e) {
    return null;
  }
};

const checkAvailability = async (from, to, trainNo, date, coachType, quota) => {
  apiCallCount++;
  try {
    const res = await fetch(
      `https://www.irctc.co.in/eticketing/protected/mapps1/avlFarenquiry/${trainNo}/${date}/${from}/${to}/${coachType}/${quota}/N`,
      {
        headers: IRCTC_HEADERS,
        referrer: "https://www.irctc.co.in/nget/booking/train-list",
        body: JSON.stringify({
          paymentFlag: "N", concessionBooking: false, ftBooking: false,
          loyaltyRedemptionBooking: false, ticketType: "E", quotaCode: quota,
          moreThanOneDay: true, returnJourney: false, returnTicket: false,
          trainNumber: trainNo, fromStnCode: from, toStnCode: to,
          isLogedinReq: false, journeyDate: date, classCode: coachType
        }),
        method: "POST", mode: "cors", credentials: "omit"
      }
    );
    return await res.json();
  } catch (err) { return null; }
};



const runInBatches = async (tasks, batchSize = 5, delayMs = 500) => {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : null));
    if (i + batchSize < tasks.length) await delay(delayMs);
  }
  return results;
};



const extractConfirmed = (availData, from, to, trainNo, trainName, coachType, tag, timeInfo = null) => {
  const results = [];
  if (!availData || !availData.avlDayList) return results;
  const fare = availData.totalFare || "N/A";
  for (const day of availData.avlDayList.slice(0, 3)) {
    if (isConfirmed(day.availablityStatus)) {
      results.push({
        trainNo, trainName, from, to, coachType,
        date: day.availablityDate,
        status: day.availablityStatus,
        fare: `₹${fare}`, tag,
        time: timeInfo
      });
    }
  }
  return results;
};


const parseTime = (timeStr) => {
  if (!timeStr || timeStr === 'First' || timeStr === 'Last') return null;
  const clean = timeStr.replace('.', ':');
  const [h, m] = clean.split(':').map(Number);
  return h * 60 + m;
};



const runSearch = async (src, dest, date, quota) => {
  apiCallCount = 0;
  const startTime = Date.now();
  const confirmedResults = [];


  const trains = filterSpecialTrains(await getTrainsBetweenStations(src, dest, date, quota));


  const routeMap = {};
  if (trains.length > 0) {
    await Promise.all(trains.map(async (t) => {
      const route = await getRoute(t.trainNumber);
      if (route) routeMap[t.trainNumber] = route;
    }));
  }

  const connectingJunctions = new Set();


  const directTasks = [];
  for (const train of trains) {
    const trainNo = train.trainNumber;
    const trainName = train.trainName;
    const trainFrom = src;
    const trainTo = dest;
    const classes = train.avlClasses || [];
    const route = routeMap[trainNo];

    if (!route) {
      const topClasses = classes.slice(0, 3);
      for (const coach of topClasses) {
        directTasks.push(() => checkAvailability(trainFrom, trainTo, trainNo, date, coach, quota)
          .then(data => extractConfirmed(data, trainFrom, trainTo, trainNo, trainName, coach, "DIRECT")));
      }
      continue;
    }

    const boardIndex = route.findIndex(s => s.source_stn_code === trainFrom);
    const destIndex = route.findIndex(s => s.source_stn_code === trainTo);
    if (boardIndex === -1 || destIndex === -1 || boardIndex >= destIndex) continue;

    const boardDay = parseInt(route[boardIndex].day, 10);
    const userDateObj = parseDate(date);
    const topClasses = classes.slice(0, 3);


    const bpStart = Math.max(0, boardIndex - 5);
    for (let i = bpStart; i <= boardIndex; i++) {
      const station = route[i];
      const code = station.source_stn_code;
      const dayDiff = boardDay - parseInt(station.day, 10);
      const qDateObj = new Date(userDateObj);
      qDateObj.setDate(userDateObj.getDate() - dayDiff - 1);
      const qDate = formatDate(qDateObj);

      for (const coach of topClasses) {
        const tag = (i === boardIndex) ? "DIRECT" : "BOARDING_CHANGE";
        directTasks.push(() => checkAvailability(code, trainTo, trainNo, qDate, coach, quota)
          .then(data => extractConfirmed(data, code, trainTo, trainNo, trainName, coach, tag)));
      }
    }
  }


  if (directTasks.length > 0) {
    const directResultsList = await runInBatches(directTasks, 5, 500);
    for (const r of directResultsList) { if (r && r.length) confirmedResults.push(...r); }
  }

  const directResults = confirmedResults.filter(r => r.tag === "DIRECT" || r.tag === "BOARDING_CHANGE");


  if (directResults.length > 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return {
      apiCallCount,
      elapsed,
      direct: directResults,
      splits: [],
      connections: [],
      threeTrain: []
    };
  }


  const splitTasks = [];
  for (const train of trains) {
    const trainNo = train.trainNumber;
    const trainName = train.trainName;
    const trainFrom = src;
    const trainTo = dest;
    const classes = train.avlClasses || [];
    const route = routeMap[trainNo];
    if (!route) continue;

    const boardIndex = route.findIndex(s => s.source_stn_code === trainFrom);
    const destIndex = route.findIndex(s => s.source_stn_code === trainTo);
    if (boardIndex === -1 || destIndex === -1 || boardIndex >= destIndex) continue;

    const boardDay = parseInt(route[boardIndex].day, 10);
    const userDateObj = parseDate(date);

    const junctions = [];
    for (let i = boardIndex + 1; i < destIndex; i++) {
      if (isMajorStation(route[i].source_stn_name)) {
        junctions.push(route[i]);
        connectingJunctions.add(route[i].source_stn_code);
      }
    }
    const topJunctions = junctions.slice(0, 3);
    const splitClasses = classes.slice(0, 2);

    for (const jct of topJunctions) {
      const splitCode = jct.source_stn_code;
      const dayDiff = boardDay - parseInt(route[boardIndex].day, 10);
      const qDateObj = new Date(userDateObj);
      qDateObj.setDate(userDateObj.getDate() - dayDiff - 1);
      const qDate = formatDate(qDateObj);

      for (const coach of splitClasses) {
        splitTasks.push(() => checkAvailability(trainFrom, splitCode, trainNo, qDate, coach, quota)
          .then(data => extractConfirmed(data, trainFrom, splitCode, trainNo, trainName, coach, `SPLIT_LEG1@${splitCode}`)));
        splitTasks.push(() => checkAvailability(splitCode, trainTo, trainNo, qDate, coach, quota)
          .then(data => extractConfirmed(data, splitCode, trainTo, trainNo, trainName, coach, `SPLIT_LEG2@${splitCode}`)));
      }
    }
  }

  if (splitTasks.length > 0) {
    const splitResultsList = await runInBatches(splitTasks, 5, 500);
    for (const r of splitResultsList) { if (r && r.length) confirmedResults.push(...r); }
  }


  const junctionList = [...connectingJunctions].slice(0, 5);

  if (junctionList.length > 0) {
    for (const jctCode of junctionList) {
      const connectingTrains = filterSpecialTrains(await getTrainsBetweenStations(jctCode, dest, date, quota));
      await delay(500);

      if (!connectingTrains.length) continue;

      const topConnecting = connectingTrains.slice(0, 3);
      const connTasks = [];

      for (const ct of topConnecting) {
        const ctClasses = (ct.avlClasses || []).slice(0, 2);
        const leg2Time = { depart: ct.departureTime };
        for (const coach of ctClasses) {
          connTasks.push(() => checkAvailability(ct.fromStnCode, ct.toStnCode, ct.trainNumber, date, coach, quota)
            .then(data => extractConfirmed(data, ct.fromStnCode, ct.toStnCode, ct.trainNumber, ct.trainName, coach, `CONNECT_LEG2@${jctCode}`, leg2Time)));
        }
      }

      for (const train of trains) {
        const route = routeMap[train.trainNumber];
        if (!route) continue;
        const srcIdx = route.findIndex(s => s.source_stn_code === src);
        const jctIdx = route.findIndex(s => s.source_stn_code === jctCode);
        if (srcIdx === -1 || jctIdx === -1 || srcIdx >= jctIdx) continue;

        const topCls = (train.avlClasses || []).slice(0, 2);
        const boardDay = parseInt(route[srcIdx].day, 10);
        const userDateObj = parseDate(date);
        const dayDiff = boardDay - parseInt(route[srcIdx].day, 10);
        const qDateObj = new Date(userDateObj);
        qDateObj.setDate(userDateObj.getDate() - dayDiff - 1);
        const qDate = formatDate(qDateObj);

        const jctArrival = route[jctIdx].arrive;
        const leg1Time = { arrive: jctArrival };
        for (const coach of topCls) {
          connTasks.push(() => checkAvailability(src, jctCode, train.trainNumber, qDate, coach, quota)
            .then(data => extractConfirmed(data, src, jctCode, train.trainNumber, train.trainName, coach, `CONNECT_LEG1@${jctCode}`, leg1Time)));
        }
      }

      const results = await runInBatches(connTasks, 5, 500);
      for (const r of results) { if (r && r.length) confirmedResults.push(...r); }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const splitLeg1 = confirmedResults.filter(r => r.tag.startsWith("SPLIT_LEG1"));
  const splitLeg2 = confirmedResults.filter(r => r.tag.startsWith("SPLIT_LEG2"));
  const validSplits = [];
  for (const l1 of splitLeg1) {
    const splitStn = l1.tag.split("@")[1];
    for (const l2 of splitLeg2) {
      if (l2.trainNo === l1.trainNo && l2.coachType === l1.coachType && l2.tag.split("@")[1] === splitStn && l2.date === l1.date) {
        validSplits.push({ leg1: l1, leg2: l2, splitStation: splitStn });
      }
    }
  }

  const parseDisplayDate = (dateStr) => {
    const parts = dateStr.split('-');
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  };

  const connLeg1 = confirmedResults.filter(r => r.tag.startsWith("CONNECT_LEG1"));
  const connLeg2 = confirmedResults.filter(r => r.tag.startsWith("CONNECT_LEG2"));
  const validConnections = [];
  for (const l1 of connLeg1) {
    const jct = l1.tag.split("@")[1];
    const leg1Date = parseDisplayDate(l1.date);
    const leg1ArriveMin = l1.time ? parseTime(l1.time.arrive) : null;

    for (const l2 of connLeg2) {
      if (l2.tag.split("@")[1] !== jct) continue;

      const leg2Date = parseDisplayDate(l2.date);
      const leg2DepartMin = l2.time ? parseTime(l2.time.depart) : null;
      const diffDays = (leg2Date - leg1Date) / (1000 * 60 * 60 * 24);

      if (diffDays < 0 || diffDays > 1) continue;

      if (leg1ArriveMin !== null && leg2DepartMin !== null) {
        const totalGapMinutes = (diffDays * 24 * 60) + (leg2DepartMin - leg1ArriveMin);
        const gapHours = totalGapMinutes / 60;

        if (gapHours < 0.5 || gapHours > 8) continue;

        validConnections.push({
          leg1: l1, leg2: l2, junction: jct,
          gapHours: gapHours.toFixed(1)
        });
      } else {
        validConnections.push({ leg1: l1, leg2: l2, junction: jct, gapHours: '?' });
      }
    }
  }


  const validThreeTrain = [];
  if (validSplits.length === 0 && validConnections.length === 0) {
    const paths = [
      ["HJP", "NDLS"],
      ["CNB", "ADI"],
      ["PNBE", "BPL"]
    ];

    for (const [hub1, hub2] of paths) {
      if (hub1 === src || hub1 === dest || hub2 === src || hub2 === dest) continue;

      const trainsLeg1 = filterSpecialTrains(await getTrainsBetweenStations(src, hub1, date, quota));
      await delay(300);
      const trainsLeg2 = filterSpecialTrains(await getTrainsBetweenStations(hub1, hub2, date, quota));
      await delay(300);
      const trainsLeg3 = filterSpecialTrains(await getTrainsBetweenStations(hub2, dest, date, quota));
      await delay(300);

      if (!trainsLeg1.length || !trainsLeg2.length || !trainsLeg3.length) continue;

      const t1 = trainsLeg1[0];
      const t2 = trainsLeg2[0];
      const t3 = trainsLeg3[0];

      const c1 = (t1.avlClasses || [])[0] || "3A";
      const c2 = (t2.avlClasses || [])[0] || "3A";
      const c3 = (t3.avlClasses || [])[0] || "3A";

      const [r1, r2, r3] = await Promise.all([
        checkAvailability(src, hub1, t1.trainNumber, date, c1, quota),
        checkAvailability(hub1, hub2, t2.trainNumber, date, c2, quota),
        checkAvailability(hub2, dest, t3.trainNumber, date, c3, quota)
      ]);

      const leg1Results = extractConfirmed(r1, src, hub1, t1.trainNumber, t1.trainName, c1, "3CONN_LEG1");
      const leg2Results = extractConfirmed(r2, hub1, hub2, t2.trainNumber, t2.trainName, c2, "3CONN_LEG2");
      const leg3Results = extractConfirmed(r3, hub2, dest, t3.trainNumber, t3.trainName, c3, "3CONN_LEG3");

      if (!leg1Results.length || !leg2Results.length || !leg3Results.length) continue;

      for (const l1 of leg1Results) {
        for (const l2 of leg2Results) {
          for (const l3 of leg3Results) {
            validThreeTrain.push({
              leg1: l1,
              leg2: l2,
              leg3: l3,
              hub1,
              hub2
            });
          }
        }
      }

      if (validThreeTrain.length > 0) break;
    }
  }

  return {
    apiCallCount,
    elapsed,
    direct: directResults,
    splits: validSplits,
    connections: validConnections,
    threeTrain: validThreeTrain
  };
};

const main = async () => {
  if (process.argv.length >= 5) {
    const src = process.argv[2].toUpperCase();
    const dest = process.argv[3].toUpperCase();
    const date = process.argv[4];
    const quota = (process.argv[5] || "GN").toUpperCase();
    rl.close();

    console.log(`\n⏳ Phase 1: Finding direct trains ${src} → ${dest}...`);
    const data = await runSearch(src, dest, date, quota);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  SEARCH COMPLETE in ${data.elapsed}s | API calls: ${data.apiCallCount}`);
    console.log(`${"=".repeat(60)}\n`);

    const directResults = data.direct;
    const validSplits = data.splits;
    const validConnections = data.connections;

    if (directResults.length === 0 && validSplits.length === 0 && validConnections.length === 0) {
      console.log("❌ No confirmed seats found across any strategy.\n");
      return;
    }

    if (directResults.length > 0) {
      console.log(`🟢 CONFIRMED SEATS - Direct / Boarding Point Change:\n`);
      const groups = {};
      for (const r of directResults) {
        const key = `${r.trainNo}_${r.coachType}`;
        if (!groups[key]) {
          groups[key] = {
            trainNo: r.trainNo,
            trainName: r.trainName,
            coachType: r.coachType,
            options: []
          };
        }
        groups[key].options.push(r);
      }

      for (const key in groups) {
        const g = groups[key];
        console.log(`  🚂 Train: ${g.trainNo} (${g.trainName}) | Class: ${g.coachType} | Route: ${src} → ${dest}`);
        for (const opt of g.options) {
          const label = opt.tag === "DIRECT" ? "📍 Direct Booking" : `🔄 Board Shift (Book from ${opt.from})`;
          console.log(`    - ${label} | Date: ${opt.date} | Fare: ${opt.fare} | Status: ${opt.status}`);
        }
        console.log();
      }
    }

    if (validSplits.length > 0) {
      console.log(`✂️  CONFIRMED SPLIT JOURNEYS (Same train, 2 tickets):\n`);
      for (const s of validSplits) {
        console.log(`  Train: ${s.leg1.trainNo} (${s.leg1.trainName}) | Split at: ${s.splitStation}`);
        console.log(`    Ticket 1: ${s.leg1.from} → ${s.leg1.to} | ${s.leg1.date} | ${s.leg1.coachType} | ${s.leg1.fare} | ${s.leg1.status}`);
        console.log(`    Ticket 2: ${s.leg2.from} → ${s.leg2.to} | ${s.leg2.date} | ${s.leg2.coachType} | ${s.leg2.fare} | ${s.leg2.status}\n`);
      }
    }

    if (validConnections.length > 0) {
      console.log(`🔗 CONFIRMED CONNECTING JOURNEYS (2 trains via junction):\n`);
      for (const c of validConnections) {
        const arrTime = c.leg1.time?.arrive || '?';
        const depTime = c.leg2.time?.depart || '?';
        console.log(`  Via: ${c.junction} | Wait: ${c.gapHours}h (arrive ${arrTime}, depart ${depTime})`);
        console.log(`    Train 1: ${c.leg1.trainNo} (${c.leg1.trainName}) | ${c.leg1.from} → ${c.leg1.to} | ${c.leg1.date} | ${c.leg1.coachType} | ${c.leg1.fare} | ${c.leg1.status}`);
        console.log(`    Train 2: ${c.leg2.trainNo} (${c.leg2.trainName}) | ${c.leg2.from} → ${c.leg2.to} | ${c.leg2.date} | ${c.leg2.coachType} | ${c.leg2.fare} | ${c.leg2.status}\n`);
      }
    }

    if (data.threeTrain && data.threeTrain.length > 0) {
      console.log(`🔗 CONFIRMED 3-TRAIN CONNECTING JOURNEYS (3 trains via hubs):\n`);
      for (const c of data.threeTrain) {
        console.log(`  Via: ${c.hub1} & ${c.hub2}`);
        console.log(`    Train 1: ${c.leg1.trainNo} (${c.leg1.trainName}) | ${c.leg1.from} → ${c.leg1.to} | ${c.leg1.date} | ${c.leg1.coachType} | ${c.leg1.status}`);
        console.log(`    Train 2: ${c.leg2.trainNo} (${c.leg2.trainName}) | ${c.leg2.from} → ${c.leg2.to} | ${c.leg2.date} | ${c.leg2.coachType} | ${c.leg2.status}`);
        console.log(`    Train 3: ${c.leg3.trainNo} (${c.leg3.trainName}) | ${c.leg3.from} → ${c.leg3.to} | ${c.leg3.date} | ${c.leg3.coachType} | ${c.leg3.status}\n`);
      }
    }

    const totalFound = directResults.length + validSplits.length + validConnections.length + (data.threeTrain ? data.threeTrain.length : 0);
    if (totalFound > 0) {
      exec(`say "${totalFound} confirmed options found"`).on('error', () => { });
    }

    console.log(`${"=".repeat(60)}\n`);
  } else {
    rl.close();
    const express = require('express');
    const path = require('path');
    const app = express();
    const PORT = 3005;

    app.use(express.json());

    app.get('/', (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.get('/api/search', async (req, res) => {
      const { src, dest, date, quota } = req.query;
      if (!src || !dest || !date) {
        return res.status(400).json({ error: "Missing required query parameters: src, dest, date" });
      }
      try {
        console.log(`\n🌐 [Web API] Searching: ${src} → ${dest} on ${date} (Quota: ${quota || 'GN'})`);
        const results = await runSearch(
          src.toUpperCase(),
          dest.toUpperCase(),
          date,
          (quota || 'GN').toUpperCase()
        );
        res.json(results);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.listen(PORT, () => {
      console.log(`\n============================================================`);
      console.log(`🚀 Smart Rail Seat Finder Web UI started on http://localhost:${PORT}`);
      console.log(`============================================================\n`);

      exec(`open http://localhost:${PORT}`).on('error', () => { });
    });
  }
};

main();
