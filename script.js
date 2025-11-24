let allPlayers = [];
let allTeams = [];
let globalMedianImpact = 0;

// current selection cache
let currentMyTeam = null;
let currentOthers = null;
let currentFreeAgents = null;
let currentDraftPicks = null;
let currentSelectedTeam = null;

// trade targets Ovr filter: "all" | "under55" | "55plus"
let targetsOvrFilter = "all";

// remembered targets for advice
let lastTradeTargets = [];      // [{ player, fitScore }]
let lastFreeAgentTargets = [];  // [{ player, fitScore }]
let lastDraftProspects = [];    // [{ player, prospectScore }]

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const teamSelect = document.getElementById("teamSelect");
  const targetsFilterSelect = document.getElementById("targetsOvrFilter");

  fileInput.addEventListener("change", handleFileChange);

  teamSelect.addEventListener("change", () => {
    const team = teamSelect.value;
    if (!team) return;
    analyzeTeam(team);
  });

  if (targetsFilterSelect) {
    targetsFilterSelect.addEventListener("change", () => {
      targetsOvrFilter = targetsFilterSelect.value;
      if (currentMyTeam && currentOthers) {
        renderTargets(currentMyTeam, currentOthers);
        renderAdvice(currentMyTeam);
      }
    });
  }
});

function handleFileChange(evt) {
  const file = evt.target.files[0];
  const errorEl = document.getElementById("fileError");
  errorEl.textContent = "";

  if (!file) return;

  Papa.parse(file, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (results.errors && results.errors.length > 0) {
        errorEl.textContent = "Error parsing CSV.";
        console.error(results.errors);
        return;
      }

      const rows = results.data || [];

      const requiredColumns = [
        "Name",
        "Pos",
        "Team",
        "Age",
        "Contract",
        "Exp",
        "Ovr",
        "Pot",
        "Hgt",
        "Str",
        "Spd",
        "Jmp",
        "End",
        "Ins",
        "Dnk",
        "FT",
        "2Pt",
        "3Pt",
        "oIQ",
        "dIQ",
        "Drb",
        "Pss",
        "Reb",
      ];

      const missing = requiredColumns.filter(
        (c) => !results.meta.fields.includes(c)
      );
      if (missing.length) {
        errorEl.textContent =
          "Missing required columns: " + missing.join(", ");
        return;
      }

      allPlayers = rows
        .filter((r) => r.Name && r.Team)
        .map((r) => normalizePlayer(r));

      if (!allPlayers.length) {
        errorEl.textContent = "No players found in file.";
        return;
      }

      addRolesAndScores(allPlayers);
      computeGlobalMedianImpact();

      const teamSet = new Set(allPlayers.map((p) => p.Team));
      allTeams = Array.from(teamSet).sort();

      const teamSelect = document.getElementById("teamSelect");
      teamSelect.innerHTML = '<option value="">Select team…</option>';
      allTeams.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        teamSelect.appendChild(opt);
      });
      teamSelect.disabled = false;
    },
  });
}

function normalizePlayer(row) {
  const numericFields = [
    "Age",
    "Contract",
    "Exp",
    "Ovr",
    "Pot",
    "Hgt",
    "Str",
    "Spd",
    "Jmp",
    "End",
    "Ins",
    "Dnk",
    "FT",
    "2Pt",
    "3Pt",
    "oIQ",
    "dIQ",
    "Drb",
    "Pss",
    "Reb",
  ];
  const p = { ...row };
  numericFields.forEach((f) => {
    const v = p[f];
    const n = typeof v === "number" ? v : Number(v);
    p[f] = Number.isFinite(n) ? n : 0;
  });
  p.Name = String(p.Name || "").trim();
  p.Pos = String(p.Pos || "").trim();
  p.Team = String(p.Team || "").trim();
  return p;
}

function analyzeTeam(team) {
  const myTeam = allPlayers.filter((p) => p.Team === team);
  const freeAgents = allPlayers.filter((p) => p.Team === "FA");
  const draftPicks = allPlayers.filter((p) => p.Team === "DP");
  const others = allPlayers.filter(
    (p) => p.Team !== team && p.Team !== "FA" && p.Team !== "DP"
  );

  if (!myTeam.length) return;

  currentSelectedTeam = team;
  currentMyTeam = myTeam;
  currentFreeAgents = freeAgents;
  currentDraftPicks = draftPicks;
  currentOthers = others;

  renderTeamOverview(myTeam);
  renderLineup(myTeam);
  renderCategories(myTeam);
  renderTargets(myTeam, others);
  renderFreeAgents(myTeam, freeAgents);
  renderDraftPicks(myTeam, draftPicks);
  renderSummary(myTeam);
  renderRanking(team);
  renderAdvice(myTeam);
}

/* ---------- Roles and impact scores ---------- */

function addRolesAndScores(players) {
  players.forEach((p) => {
    p.role = determineRole(p.Pos);
    p.impactScore = computeImpactScore(p);
  });
}

// Treat GF as a guard-type so good GFs can be primary handlers
function determineRole(posRaw) {
  const pos = (posRaw || "").toUpperCase();

  // Perimeter / ball-handler types
  if (pos.includes("PG")) return "G";
  if (pos.includes("SG")) return "G";
  if (pos.includes("GF")) return "G";
  if (pos === "G") return "G";

  // Bigs
  if (pos.includes("C")) return "B";
  if (pos.includes("PF") || pos.includes("FC")) return "B";

  // Wings / forwards
  if (pos.includes("SF") || pos === "F") return "W";

  // Fallbacks
  if (pos.includes("G")) return "G";
  if (pos.includes("F")) return "W";
  return "B";
}

function val(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

function guardScore(p) {
  return (
    0.006 * val(p.Hgt) +
    0.081 * val(p.Str) +
    0.014 * val(p.Spd) +
    0.009 * val(p.Jmp) +
    0.070 * val(p.End) +
    0.067 * val(p.Ins) +
    0.046 * val(p.Dnk) +
    0.080 * val(p.FT) +
    0.083 * val(p["2Pt"]) +
    0.086 * val(p["3Pt"]) +
    0.101 * val(p.oIQ) +
    0.090 * val(p.dIQ) +
    0.088 * val(p.Drb) +
    0.088 * val(p.Pss) +
    0.093 * val(p.Reb)
  );
}

function wingScore(p) {
  return (
    0.037 * val(p.Hgt) +
    0.058 * val(p.Str) +
    0.015 * val(p.Spd) +
    0.009 * val(p.Jmp) +
    0.079 * val(p.End) +
    0.057 * val(p.Ins) +
    0.079 * val(p.Dnk) +
    0.081 * val(p.FT) +
    0.079 * val(p["2Pt"]) +
    0.082 * val(p["3Pt"]) +
    0.105 * val(p.oIQ) +
    0.089 * val(p.dIQ) +
    0.079 * val(p.Drb) +
    0.083 * val(p.Pss) +
    0.067 * val(p.Reb)
  );
}

function bigScore(p) {
  return (
    0.032 * val(p.Hgt) +
    0.074 * val(p.Str) +
    0.022 * val(p.Spd) +
    0.007 * val(p.Jmp) +
    0.071 * val(p.End) +
    0.049 * val(p.Ins) +
    0.081 * val(p.Dnk) +
    0.074 * val(p.FT) +
    0.076 * val(p["2Pt"]) +
    0.075 * val(p["3Pt"]) +
    0.111 * val(p.oIQ) +
    0.093 * val(p.dIQ) +
    0.085 * val(p.Drb) +
    0.084 * val(p.Pss) +
    0.066 * val(p.Reb)
  );
}

function computeImpactScore(p) {
  if (p.role === "G") return guardScore(p);
  if (p.role === "W") return wingScore(p);
  return bigScore(p);
}

function computeGlobalMedianImpact() {
  const scores = allPlayers
    .map((p) => p.impactScore)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!scores.length) {
    globalMedianImpact = 0;
    return;
  }
  const mid = Math.floor(scores.length / 2);
  globalMedianImpact =
    scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
}

/* ---------- Team power score for rankings ---------- */

function computeTeamPowerScore(teamPlayers) {
  if (!teamPlayers || !teamPlayers.length) return 0;
  const sorted = [...teamPlayers].sort(
    (a, b) => b.impactScore - a.impactScore
  );
  const n = Math.min(8, sorted.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += sorted[i].impactScore;
  }
  return sum / n;
}

/* ---------- Rendering: team overview ---------- */

function renderTeamOverview(myTeam) {
  const container = document.getElementById("teamOverview");
  const playersSorted = [...myTeam].sort(
    (a, b) => b.impactScore - a.impactScore
  );

  const avg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const topForAvg = playersSorted.slice(0, Math.min(9, playersSorted.length));
  const avgOvr = avg(topForAvg.map((p) => p.Ovr));
  const avgPot = avg(topForAvg.map((p) => p.Pot));
  const avgAge = avg(topForAvg.map((p) => p.Age));
  const avgStr = avg(topForAvg.map((p) => p.Str));
  const avgSpd = avg(topForAvg.map((p) => p.Spd));
  const avgHgt = avg(topForAvg.map((p) => p.Hgt));
  const avg3 = avg(topForAvg.map((p) => p["3Pt"]));
  const avg2 = avg(topForAvg.map((p) => p["2Pt"]));
  const avgFT = avg(topForAvg.map((p) => p.FT));
  const avgDrb = avg(topForAvg.map((p) => p.Drb));
  const avgPss = avg(topForAvg.map((p) => p.Pss));
  const avgReb = avg(topForAvg.map((p) => p.Reb));
  const avgDIQ = avg(topForAvg.map((p) => p.dIQ));
  const avgOIQ = avg(topForAvg.map((p) => p.oIQ));

  let html = "";
  html += `<div class="section-block">
    <h3>Top rotation snapshot (top ${topForAvg.length} by impact)</h3>
    <p>Avg Ovr: ${avgOvr.toFixed(1)} | Avg Pot: ${avgPot.toFixed(
    1
  )} | Avg Age: ${avgAge.toFixed(1)}</p>
    <p>Avg Str: ${avgStr.toFixed(1)} | Spd: ${avgSpd.toFixed(
    1
  )} | Hgt: ${avgHgt.toFixed(1)}</p>
    <p>Shooting – 2Pt: ${avg2.toFixed(1)} | 3Pt: ${avg3.toFixed(
    1
  )} | FT: ${avgFT.toFixed(1)}</p>
    <p>Playmaking – Drb: ${avgDrb.toFixed(1)} | Pss: ${avgPss.toFixed(
    1
  )}</p>
    <p>Defense / rebounding – dIQ: ${avgDIQ.toFixed(
      1
    )} | Reb: ${avgReb.toFixed(1)} | oIQ: ${avgOIQ.toFixed(1)}</p>
  </div>`;

  html += `<div class="section-block">
    <h3>All players</h3>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Pos</th>
          <th>Role</th>
          <th>Age</th>
          <th>Ovr</th>
          <th>Pot</th>
          <th>Impact</th>
          <th>3Pt</th>
          <th>2Pt</th>
          <th>Str</th>
          <th>Spd</th>
          <th>Reb</th>
          <th>oIQ</th>
          <th>dIQ</th>
        </tr>
      </thead>
      <tbody>
  `;

  playersSorted.forEach((p) => {
    html += `<tr>
      <td>${escapeHtml(p.Name)}</td>
      <td>${escapeHtml(p.Pos)}</td>
      <td>${p.role}</td>
      <td>${p.Age}</td>
      <td>${p.Ovr}</td>
      <td>${p.Pot}</td>
      <td>${p.impactScore.toFixed(1)}</td>
      <td>${p["3Pt"]}</td>
      <td>${p["2Pt"]}</td>
      <td>${p.Str}</td>
      <td>${p.Spd}</td>
      <td>${p.Reb}</td>
      <td>${p.oIQ}</td>
      <td>${p.dIQ}</td>
    </tr>`;
  });

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/* ---------- Rendering: lineup ---------- */

function samePlayer(a, b) {
  return a.Name === b.Name && a.Team === b.Team && a.Age === b.Age;
}

function pickStarters(players) {
  const sorted = [...players].sort((a, b) => b.impactScore - a.impactScore);

  if (sorted.length <= 5) {
    return sorted;
  }

  // best 5 by impact
  let starters = sorted.slice(0, 5);

  const hasRole = (list, role) => list.some((p) => p.role === role);
  const bestWithRole = (role) => sorted.find((p) => p.role === role);

  const replaceLowestNonRole = (list, role, candidate) => {
    if (!candidate) return list;
    if (hasRole(list, role)) return list;
    if (list.some((p) => samePlayer(p, candidate))) return list;

    let worstIdx = -1;
    let worstImpact = Infinity;

    list.forEach((p, idx) => {
      if (p.role === role) return;
      if (p.impactScore < worstImpact) {
        worstImpact = p.impactScore;
        worstIdx = idx;
      }
    });

    if (worstIdx === -1) return list;

    const newList = [...list];
    newList[worstIdx] = candidate;
    return newList;
  };

  const bestBig = bestWithRole("B");
  const bestGuard = bestWithRole("G");

  // ensure at least one big and one guard if possible
  starters = replaceLowestNonRole(starters, "B", bestBig);
  starters = replaceLowestNonRole(starters, "G", bestGuard);

  return starters;
}

function renderLineup(myTeam) {
  const container = document.getElementById("lineup");
  const players = [...myTeam];

  const starters = pickStarters(players);
  const starterIds = new Set(starters.map((p) => playerKey(p)));
  const remaining = players.filter((p) => !starterIds.has(playerKey(p)));
  const bench = remaining
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(6, remaining.length));

  let html = "";

  html += `<div class="section-block">
    <h3>Recommended starting five (best 5 by impact with ≥1 G and ≥1 B when possible)</h3>
    ${renderPlayerTable(starters)}
  </div>`;

  html += `<div class="section-block">
    <h3>Recommended main bench (next ${
      bench.length
    } by impact, up to 6)</h3>
    ${renderPlayerTable(bench)}
  </div>`;

  container.innerHTML = html;
}

function renderPlayerTable(players) {
  if (!players.length) return "<p>No players available.</p>";

  let html = `<table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Pos</th>
        <th>Role</th>
        <th>Age</th>
        <th>Ovr</th>
        <th>Impact</th>
        <th>3Pt</th>
        <th>2Pt</th>
        <th>FT</th>
        <th>Str</th>
        <th>Spd</th>
        <th>Reb</th>
        <th>oIQ</th>
        <th>dIQ</th>
      </tr>
    </thead>
    <tbody>
  `;
  players.forEach((p) => {
    html += `<tr>
      <td>${escapeHtml(p.Name)}</td>
      <td>${escapeHtml(p.Pos)}</td>
      <td>${p.role}</td>
      <td>${p.Age}</td>
      <td>${p.Ovr}</td>
      <td>${p.impactScore.toFixed(1)}</td>
      <td>${p["3Pt"]}</td>
      <td>${p["2Pt"]}</td>
      <td>${p.FT}</td>
      <td>${p.Str}</td>
      <td>${p.Spd}</td>
      <td>${p.Reb}</td>
      <td>${p.oIQ}</td>
      <td>${p.dIQ}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  return html;
}

/* ---------- Rendering: categories ---------- */

function renderCategories(myTeam) {
  const container = document.getElementById("categories");
  const impacts = myTeam
    .map((p) => p.impactScore)
    .sort((a, b) => a - b);
  const medianImpact =
    impacts.length === 0
      ? 0
      : impacts.length % 2
      ? impacts[Math.floor(impacts.length / 2)]
      : (impacts[impacts.length / 2 - 1] +
          impacts[impacts.length / 2]) /
        2;

  const groups = {
    Core: [],
    Rotation: [],
    Prospect: [],
    Trade: [],
    Cut: [],
  };

  myTeam.forEach((p) => {
    const cat = categorizePlayer(p, medianImpact);
    groups[cat].push(p);
  });

  let html = "";

  const order = ["Core", "Rotation", "Prospect", "Trade", "Cut"];
  const badgeClass = {
    Core: "badge-core",
    Rotation: "badge-rotation",
    Prospect: "badge-prospect",
    Trade: "badge-trade",
    Cut: "badge-cut",
  };

  order.forEach((cat) => {
    const list = groups[cat].sort((a, b) => b.impactScore - a.impactScore);
    html += `<div class="section-block">
      <h3>${cat} (${list.length})</h3>`;
    if (!list.length) {
      html += "<p>None.</p></div>";
      return;
    }
    html += `<table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Pos</th>
          <th>Role</th>
          <th>Age</th>
          <th>Ovr</th>
          <th>Pot</th>
          <th>Impact</th>
          <th>3Pt</th>
          <th>Str</th>
          <th>Reb</th>
        </tr>
      </thead>
      <tbody>`;

    list.forEach((p) => {
      html += `<tr>
        <td>
          <span class="badge ${badgeClass[cat]}">${cat}</span>
          ${escapeHtml(p.Name)}
        </td>
        <td>${escapeHtml(p.Pos)}</td>
        <td>${p.role}</td>
        <td>${p.Age}</td>
        <td>${p.Ovr}</td>
        <td>${p.Pot}</td>
        <td>${p.impactScore.toFixed(1)}</td>
        <td>${p["3Pt"]}</td>
        <td>${p.Str}</td>
        <td>${p.Reb}</td>
      </tr>`;
    });

    html += "</tbody></table></div>";
  });

  container.innerHTML = html;
}

function categorizePlayer(p, teamMedianImpact) {
  const ovr = val(p.Ovr);
  const age = val(p.Age);
  const pot = val(p.Pot);
  const gap = pot - ovr;
  const score = p.impactScore || 0;

  const highCeilingProspect = age <= 24 && pot >= 60 && gap >= 8;
  const eliteCeilingProspect = age <= 26 && pot >= 70 && gap >= 5;

  if (ovr >= 60 && score >= teamMedianImpact + 3 && age <= 29) {
    return "Core";
  }

  const baseProspect = age <= 23 && gap >= 10 && ovr >= 50;

  if (highCeilingProspect || eliteCeilingProspect || baseProspect) {
    return "Prospect";
  }

  if (ovr >= 55 && score >= teamMedianImpact - 5) {
    return "Rotation";
  }

  if (
    ovr < 50 ||
    (score < teamMedianImpact - 8 && gap < 8 && age >= 25)
  ) {
    return "Cut";
  }

  return "Trade";
}

/* ---------- Rendering: trade targets (other teams) ---------- */

function renderTargets(myTeam, others) {
  const container = document.getElementById("targets");

  if (!others.length) {
    lastTradeTargets = [];
    container.innerHTML = "<p>No other players in file.</p>";
    return;
  }

  // mark team stars (top 2 per team)
  const teamPlayersMap = {};
  allPlayers.forEach((p) => {
    if (!teamPlayersMap[p.Team]) {
      teamPlayersMap[p.Team] = [];
    }
    teamPlayersMap[p.Team].push(p);
  });

  Object.keys(teamPlayersMap).forEach((team) => {
    const arr = teamPlayersMap[team].slice().sort(
      (a, b) => b.impactScore - a.impactScore
    );
    arr.forEach((p, idx) => {
      p._isStar = idx < 2;
    });
  });

  const myTop = [...myTeam]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(9, myTeam.length));

  const avg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const team3 = avg(myTop.map((p) => p["3Pt"]));
  const teamReb = avg(myTop.map((p) => p.Reb));
  const teamDIQ = avg(myTop.map((p) => p.dIQ));
  const teamStr = avg(myTop.map((p) => p.Str));

  const needShoot = team3 < 55;
  const needReb = teamReb < 55;
  const needDef = teamDIQ < 55;
  const needStr = teamStr < 55;

  const candidates = [];

  others.forEach((p) => {
    const ovr = val(p.Ovr);

    if (targetsOvrFilter === "under55" && ovr >= 55) return;
    if (targetsOvrFilter === "55plus" && ovr < 55) return;

    const age = val(p.Age);
    const pot = val(p.Pot);
    const gap = pot - ovr;
    const score = p.impactScore || 0;

    if (ovr >= 70) return;

    if (p._isStar && ovr >= 65 && age <= 30) {
      return;
    }

    const isImpactCandidate =
      ovr >= 60 || (age <= 24 && gap >= 10 && score >= globalMedianImpact + 5);
    if (!isImpactCandidate) return;

    let fit = score;
    if (needShoot) {
      fit += Math.max(0, p["3Pt"] - 55) * 0.5;
    }
    if (needReb && p.role === "B") {
      fit += Math.max(0, p.Reb - 60) * 0.3;
    }
    if (needDef) {
      fit += Math.max(0, p.dIQ - 55) * 0.4;
    }
    if (needStr) {
      fit += Math.max(0, p.Str - 55) * 0.3;
    }

    candidates.push({ player: p, fitScore: fit });
  });

  candidates.sort((a, b) => b.fitScore - a.fitScore);
  const top = candidates.slice(0, Math.min(15, candidates.length));

  lastTradeTargets = top;

  if (!top.length) {
    container.innerHTML =
      "<p>No obvious trade targets based on current thresholds and filter.</p>";
    return;
  }

  let html = `<p>Top suggested trade targets (max 15), excluding obvious untouchables (Ovr ≥ 70 and most team stars).</p>`;
  html += `<table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Team</th>
        <th>Pos</th>
        <th>Role</th>
        <th>Age</th>
        <th>Ovr</th>
        <th>Pot</th>
        <th>Impact</th>
        <th>FitScore</th>
        <th>3Pt</th>
        <th>Str</th>
        <th>Reb</th>
        <th>oIQ</th>
        <th>dIQ</th>
      </tr>
    </thead>
    <tbody>`;

  top.forEach(({ player: p, fitScore }) => {
    html += `<tr>
      <td>${escapeHtml(p.Name)}</td>
      <td>${escapeHtml(p.Team)}</td>
      <td>${escapeHtml(p.Pos)}</td>
      <td>${p.role}</td>
      <td>${p.Age}</td>
      <td>${p.Ovr}</td>
      <td>${p.Pot}</td>
      <td>${p.impactScore.toFixed(1)}</td>
      <td>${fitScore.toFixed(1)}</td>
      <td>${p["3Pt"]}</td>
      <td>${p.Str}</td>
      <td>${p.Reb}</td>
      <td>${p.oIQ}</td>
      <td>${p.dIQ}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

/* ---------- Rendering: free agents ---------- */

function renderFreeAgents(myTeam, freeAgents) {
  const container = document.getElementById("freeAgents");

  if (!freeAgents.length) {
    lastFreeAgentTargets = [];
    container.innerHTML = "<p>No free agents (Team = FA) in this file.</p>";
    return;
  }

  const myTop = [...myTeam]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(9, myTeam.length));

  const avg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const team3 = avg(myTop.map((p) => p["3Pt"]));
  const teamReb = avg(myTop.map((p) => p.Reb));
  const teamDIQ = avg(myTop.map((p) => p.dIQ));
  const teamStr = avg(myTop.map((p) => p.Str));

  const needShoot = team3 < 55;
  const needReb = teamReb < 55;
  const needDef = teamDIQ < 55;
  const needStr = teamStr < 55;

  const candidates = [];

  freeAgents.forEach((p) => {
    const ovr = val(p.Ovr);
    const age = val(p.Age);
    const pot = val(p.Pot);
    const gap = pot - ovr;
    const score = p.impactScore || 0;

    const isCandidate =
      ovr >= 55 || (age <= 26 && gap >= 8 && score >= globalMedianImpact);
    if (!isCandidate) return;

    let fit = score;
    if (needShoot) {
      fit += Math.max(0, p["3Pt"] - 55) * 0.5;
    }
    if (needReb && p.role === "B") {
      fit += Math.max(0, p.Reb - 60) * 0.3;
    }
    if (needDef) {
      fit += Math.max(0, p.dIQ - 55) * 0.4;
    }
    if (needStr) {
      fit += Math.max(0, p.Str - 55) * 0.3;
    }

    if (age <= 24 && gap >= 10) {
      fit += 5;
    }

    candidates.push({ player: p, fitScore: fit });
  });

  candidates.sort((a, b) => b.fitScore - a.fitScore);
  const top = candidates.slice(0, Math.min(15, candidates.length));

  lastFreeAgentTargets = top;

  if (!top.length) {
    container.innerHTML =
      "<p>No free agents look like meaningful upgrades with current thresholds.</p>";
    return;
  }

  let html = `<p>Free agents (Team = FA) that fit your roster needs (max 15).</p>`;
  html += `<table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Pos</th>
        <th>Role</th>
        <th>Age</th>
        <th>Ovr</th>
        <th>Pot</th>
        <th>Impact</th>
        <th>FitScore</th>
        <th>3Pt</th>
        <th>Str</th>
        <th>Reb</th>
        <th>oIQ</th>
        <th>dIQ</th>
      </tr>
    </thead>
    <tbody>`;

  top.forEach(({ player: p, fitScore }) => {
    html += `<tr>
      <td>${escapeHtml(p.Name)}</td>
      <td>${escapeHtml(p.Pos)}</td>
      <td>${p.role}</td>
      <td>${p.Age}</td>
      <td>${p.Ovr}</td>
      <td>${p.Pot}</td>
      <td>${p.impactScore.toFixed(1)}</td>
      <td>${fitScore.toFixed(1)}</td>
      <td>${p["3Pt"]}</td>
      <td>${p.Str}</td>
      <td>${p.Reb}</td>
      <td>${p.oIQ}</td>
      <td>${p.dIQ}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

/* ---------- Rendering: draft picks ---------- */

function renderDraftPicks(myTeam, draftPicks) {
  const container = document.getElementById("draftPicks");

  if (!draftPicks.length) {
    lastDraftProspects = [];
    container.innerHTML = "<p>No draft picks (Team = DP) in this file.</p>";
    return;
  }

  const myTop = [...myTeam]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(9, myTeam.length));

  const avg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const team3 = avg(myTop.map((p) => p["3Pt"]));
  const teamReb = avg(myTop.map((p) => p.Reb));
  const teamDIQ = avg(myTop.map((p) => p.dIQ));
  const teamStr = avg(myTop.map((p) => p.Str));

  const needShoot = team3 < 55;
  const needReb = teamReb < 55;
  const needDef = teamDIQ < 55;
  const needStr = teamStr < 55;

  const candidates = [];

  draftPicks.forEach((p) => {
    const ovr = val(p.Ovr);
    const age = val(p.Age);
    const pot = val(p.Pot);
    const gap = pot - ovr;
    const score = p.impactScore || 0;

    const isProspect =
      age <= 25 && pot >= 60 && gap >= 8 && score >= globalMedianImpact * 0.7;
    if (!isProspect) return;

    let prospectScore =
      0.4 * score + 0.4 * pot + 0.2 * gap - Math.max(0, age - 22) * 2;

    if (needShoot) {
      prospectScore += Math.max(0, p["3Pt"] - 55) * 0.3;
    }
    if (needReb && p.role === "B") {
      prospectScore += Math.max(0, p.Reb - 60) * 0.2;
    }
    if (needDef) {
      prospectScore += Math.max(0, p.dIQ - 55) * 0.25;
    }
    if (needStr) {
      prospectScore += Math.max(0, p.Str - 55) * 0.2;
    }

    candidates.push({ player: p, prospectScore });
  });

  candidates.sort((a, b) => b.prospectScore - a.prospectScore);
  const top = candidates.slice(0, Math.min(15, candidates.length));

  lastDraftProspects = top;

  if (!top.length) {
    container.innerHTML =
      "<p>No draft prospects stand out given current thresholds.</p>";
    return;
  }

  let html = `<p>Draft picks (Team = DP) ranked by prospect score (max 15).</p>`;
  html += `<table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Pos</th>
        <th>Role</th>
        <th>Age</th>
        <th>Ovr</th>
        <th>Pot</th>
        <th>Impact</th>
        <th>ProspectScore</th>
        <th>3Pt</th>
        <th>Str</th>
        <th>Reb</th>
        <th>oIQ</th>
        <th>dIQ</th>
      </tr>
    </thead>
    <tbody>`;

  top.forEach(({ player: p, prospectScore }) => {
    html += `<tr>
      <td>${escapeHtml(p.Name)}</td>
      <td>${escapeHtml(p.Pos)}</td>
      <td>${p.role}</td>
      <td>${p.Age}</td>
      <td>${p.Ovr}</td>
      <td>${p.Pot}</td>
      <td>${p.impactScore.toFixed(1)}</td>
      <td>${prospectScore.toFixed(1)}</td>
      <td>${p["3Pt"]}</td>
      <td>${p.Str}</td>
      <td>${p.Reb}</td>
      <td>${p.oIQ}</td>
      <td>${p.dIQ}</td>
    </tr>`;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

/* ---------- Rendering: summary ---------- */

function renderSummary(myTeam) {
  const container = document.getElementById("summary");

  const topMy = [...myTeam]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(9, myTeam.length));

  const topAll = [...allPlayers]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(200, allPlayers.length));

  const avg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const shootingScore = (p) =>
    0.4 * val(p["3Pt"]) + 0.35 * val(p["2Pt"]) + 0.25 * val(p.FT);
  const playmakingScore = (p) =>
    0.4 * val(p.Drb) + 0.4 * val(p.Pss) + 0.2 * val(p.oIQ);
  const defenseScore = (p) =>
    0.5 * val(p.dIQ) +
    0.2 * val(p.Reb) +
    0.2 * val(p.Str) +
    0.1 * val(p.Hgt);
  const physicalScore = (p) =>
    0.4 * val(p.Str) +
    0.3 * val(p.End) +
    0.2 * val(p.Spd) +
    0.1 * val(p.Jmp);

  const myShoot = avg(topMy.map(shootingScore));
  const myPlay = avg(topMy.map(playmakingScore));
  const myDef = avg(topMy.map(defenseScore));
  const myPhys = avg(topMy.map(physicalScore));
  const myAge = avg(topMy.map((p) => p.Age));
  const myPotGap = avg(topMy.map((p) => p.Pot - p.Ovr));

  const allShoot = avg(topAll.map(shootingScore));
  const allPlay = avg(topAll.map(playmakingScore));
  const allDef = avg(topAll.map(defenseScore));
  const allPhys = avg(topAll.map(physicalScore));
  const allAge = avg(topAll.map((p) => p.Age));
  const allPotGap = avg(topAll.map((p) => p.Pot - p.Ovr));

  function classify(myVal, allVal, tol = 3) {
    if (myVal >= allVal + tol) return "Strong";
    if (myVal <= allVal - tol) return "Weak";
    return "Average";
  }

  const shootingLabel = classify(myShoot, allShoot);
  const playLabel = classify(myPlay, allPlay);
  const defLabel = classify(myDef, allDef);
  const physLabel = classify(myPhys, allPhys);
  const youthLabel = classify(allAge - myAge, 0, 0.5);

  let html = "<ul class='summary-list'>";

  html += `<li>Shooting: ${shootingLabel} (your score ${myShoot.toFixed(
    1
  )}, league ${allShoot.toFixed(1)})</li>`;
  html += `<li>Playmaking: ${playLabel} (your score ${myPlay.toFixed(
    1
  )}, league ${allPlay.toFixed(1)})</li>`;
  html += `<li>Defense: ${defLabel} (your score ${myDef.toFixed(
    1
  )}, league ${allDef.toFixed(1)})</li>`;
  html += `<li>Physicality: ${physLabel} (your score ${myPhys.toFixed(
    1
  )}, league ${allPhys.toFixed(1)})</li>`;
  html += `<li>Youth/upside: ${youthLabel} (avg age ${myAge.toFixed(
    1
  )} vs league ${allAge.toFixed(1)}, Pot–Ovr gap ${myPotGap.toFixed(
    1
  )} vs ${allPotGap.toFixed(1)})</li>`;

  html += "</ul>";

  container.innerHTML = html;
}

/* ---------- Rendering: team ranking vs league (adjusted) ---------- */

function renderRanking(selectedTeam) {
  const container = document.getElementById("ranking");

  const teamMeta = [];

  const teamsSet = new Set(
    allPlayers
      .map((p) => p.Team)
      .filter((t) => t !== "FA" && t !== "DP")
  );

  teamsSet.forEach((team) => {
    const players = allPlayers.filter((p) => p.Team === team);
    if (!players.length) return;

    const sorted = [...players].sort(
      (a, b) => b.impactScore - a.impactScore
    );
    const top = sorted.slice(0, Math.min(8, sorted.length));

    const basePower = computeTeamPowerScore(players);

    let sumAge = 0;
    let count = 0;
    let countG = 0;
    let countW = 0;
    let countB = 0;

    top.forEach((p) => {
      const age = val(p.Age);
      sumAge += age;
      count += 1;
      if (p.role === "G") countG += 1;
      else if (p.role === "W") countW += 1;
      else if (p.role === "B") countB += 1;
    });

    const avgAge = count ? sumAge / count : 0;

    teamMeta.push({
      team,
      basePower,
      avgAge,
      countG,
      countW,
      countB,
      adjPower: basePower,
    });
  });

  if (!teamMeta.length) {
    container.innerHTML =
      "<p>Ranking is only computed for league teams (not FA/DP).</p>";
    return;
  }

  const leagueAvgAge =
    teamMeta.reduce((s, t) => s + t.avgAge, 0) / teamMeta.length;

  teamMeta.forEach((t) => {
    let adj = t.basePower;

    const ageDiff = t.avgAge - leagueAvgAge;
    if (ageDiff > 3) {
      adj -= 4;
    } else if (ageDiff > 1.5) {
      adj -= 2;
    } else if (ageDiff < -3) {
      adj += 2;
    } else if (ageDiff < -1.5) {
      adj += 1;
    }

    if (t.countG === 0) adj -= 5;
    else if (t.countG === 1) adj -= 2;

    if (t.countB === 0) adj -= 5;
    else if (t.countB === 1) adj -= 2;

    t.adjPower = adj;
  });

  teamMeta.sort((a, b) => b.adjPower - a.adjPower);

  const rankIndex = teamMeta.findIndex((t) => t.team === selectedTeam);
  if (rankIndex === -1) {
    container.innerHTML =
      "<p>Ranking is only computed for league teams (not FA/DP).</p>";
    return;
  }

  const totalTeams = teamMeta.length;
  const myEntry = teamMeta[rankIndex];
  const myRank = rankIndex + 1;

  let winBandText = "";
  if (myRank <= 3) {
    winBandText =
      "Projected wins: ~52–60 (title contender tier).";
  } else if (myRank <= 6) {
    winBandText =
      "Projected wins: ~48–55 (strong playoff team).";
  } else if (myRank <= 10) {
    winBandText =
      "Projected wins: ~44–52 (playoff caliber).";
  } else if (myRank <= 16) {
    winBandText =
      "Projected wins: ~38–46 (play-in / fringe playoff).";
  } else if (myRank <= 22) {
    winBandText =
      "Projected wins: ~32–40 (lottery team).";
  } else {
    winBandText = "Projected wins: ~25–35 (rebuild tier).";
  }

  const warnings = [];
  const ageDiff = myEntry.avgAge - leagueAvgAge;

  if (ageDiff > 1.5) {
    warnings.push(
      `Old rotation: avg age ${myEntry.avgAge.toFixed(
        1
      )} vs league ${leagueAvgAge.toFixed(
        1
      )} – higher risk of decline and injuries.`
    );
  } else if (ageDiff < -1.5) {
    warnings.push(
      `Very young rotation: avg age ${myEntry.avgAge.toFixed(
        1
      )} vs league ${leagueAvgAge.toFixed(
        1
      )} – performance may be volatile.`
    );
  }

  if (myEntry.countG <= 1) {
    warnings.push(
      "Limited guard depth in top 8 – ball handling and creation may be an issue."
    );
  }
  if (myEntry.countB <= 1) {
    warnings.push(
      "Limited big depth in top 8 – interior defense and rebounding may be an issue."
    );
  }
  if (myEntry.countG >= 3 && myEntry.countB <= 1) {
    warnings.push(
      "Very small top-8 rotation – could struggle on the boards and against strong bigs."
    );
  }

  let html = "";

  html += `<div class="section-block">
    <h3>Overall team strength</h3>
    <p>Raw team power score (avg impact of top 8): ${myEntry.basePower.toFixed(
      1
    )}</p>
    <p>Adjusted team power score (age & positional balance): ${myEntry.adjPower.toFixed(
      1
    )}</p>
    <p>League teams: ${totalTeams}. Your rank: ${myRank} of ${totalTeams}.</p>
    <p>${winBandText}</p>
  </div>`;

  if (warnings.length) {
    html += `<div class="section-block">
      <h4>Risk flags</h4>
      <ul>`;
    warnings.forEach((w) => {
      html += `<li>${w}</li>`;
    });
    html += `</ul></div>`;
  } else {
    html += `<div class="section-block">
      <h4>Risk flags</h4>
      <p>No major structural red flags; performance should track talent fairly closely.</p>
    </div>`;
  }

  const topN = Math.min(10, teamMeta.length);
  html += `<div class="section-block">
    <h3>Top ${topN} teams by adjusted power score</h3>
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Team</th>
          <th>Adj. power</th>
          <th>Avg age (top 8)</th>
          <th>G/W/B in top 8</th>
        </tr>
      </thead>
      <tbody>`;

  for (let i = 0; i < topN; i++) {
    const t = teamMeta[i];
    html += `<tr>
      <td>${i + 1}</td>
      <td>${t.team}${t.team === selectedTeam ? " (you)" : ""}</td>
      <td>${t.adjPower.toFixed(1)}</td>
      <td>${t.avgAge.toFixed(1)}</td>
      <td>${t.countG}/${t.countW}/${t.countB}</td>
    </tr>`;
  }

  html += "</tbody></table></div>";

  container.innerHTML = html;
}

/* ---------- Rendering: roster improvement advice ---------- */

function renderAdvice(myTeam) {
  const container = document.getElementById("advice");
  if (!container) return;

  if (!myTeam || !myTeam.length) {
    container.innerHTML = "<p>Select a team to see advice.</p>";
    return;
  }

  const playersSorted = [...myTeam].sort(
    (a, b) => b.impactScore - a.impactScore
  );
  const topMy = playersSorted.slice(0, Math.min(9, playersSorted.length));

  const avg = (arr) =>
    arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const shootingScore = (p) =>
    0.4 * val(p["3Pt"]) + 0.35 * val(p["2Pt"]) + 0.25 * val(p.FT);
  const playmakingScore = (p) =>
    0.4 * val(p.Drb) + 0.4 * val(p.Pss) + 0.2 * val(p.oIQ);
  const defenseScore = (p) =>
    0.5 * val(p.dIQ) +
    0.2 * val(p.Reb) +
    0.2 * val(p.Str) +
    0.1 * val(p.Hgt);
  const physicalScore = (p) =>
    0.4 * val(p.Str) +
    0.3 * val(p.End) +
    0.2 * val(p.Spd) +
    0.1 * val(p.Jmp);

  const myShoot = avg(topMy.map(shootingScore));
  const myPlay = avg(topMy.map(playmakingScore));
  const myDef = avg(topMy.map(defenseScore));
  const myPhys = avg(topMy.map(physicalScore));
  const myAge = avg(topMy.map((p) => p.Age));
  const myPotGap = avg(topMy.map((p) => p.Pot - p.Ovr));

  const topAll = [...allPlayers]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, Math.min(200, allPlayers.length));
  const allShoot = avg(topAll.map(shootingScore));
  const allPlay = avg(topAll.map(playmakingScore));
  const allDef = avg(topAll.map(defenseScore));
  const allPhys = avg(topAll.map(physicalScore));
  const allAge = avg(topAll.map((p) => p.Age));
  const allPotGap = avg(topAll.map((p) => p.Pot - p.Ovr));

  const classify = (myVal, allVal, tol = 3) => {
    if (myVal >= allVal + tol) return "Strong";
    if (myVal <= allVal - tol) return "Weak";
    return "Average";
  };

  const shootingLabel = classify(myShoot, allShoot);
  const playLabel = classify(myPlay, allPlay);
  const defLabel = classify(myDef, allDef);
  const physLabel = classify(myPhys, allPhys);
  const youthLabel = classify(allAge - myAge, 0, 0.5);

  const teamScores = [];
  const teamsSet = new Set(
    allPlayers
      .map((p) => p.Team)
      .filter((t) => t !== "FA" && t !== "DP")
  );
  teamsSet.forEach((team) => {
    const players = allPlayers.filter((p) => p.Team === team);
    const score = computeTeamPowerScore(players);
    const sortedTop = [...players].sort(
      (a, b) => b.impactScore - a.impactScore
    );
    const rTop = sortedTop.slice(0, Math.min(8, sortedTop.length));
    const avgAge =
      rTop.length === 0
        ? 0
        : rTop.reduce((s, x) => s + val(x.Age), 0) / rTop.length;
    teamScores.push({ team, score, avgAge });
  });

  teamScores.sort((a, b) => b.score - a.score);
  const myIdx = teamScores.findIndex(
    (t) => t.team === currentSelectedTeam
  );
  const myRank = myIdx >= 0 ? myIdx + 1 : null;
  const totalTeams = teamScores.length;
  const leagueAvgAge =
    teamScores.reduce((s, t) => s + t.avgAge, 0) / totalTeams;

  let tier = "Unknown";
  let winBandText = "";
  if (myRank !== null) {
    if (myRank <= 3) {
      tier = "title contender";
      winBandText = "roughly 52–60 wins in expectation.";
    } else if (myRank <= 6) {
      tier = "strong playoff team";
      winBandText = "roughly 48–55 wins in expectation.";
    } else if (myRank <= 10) {
      tier = "playoff-caliber team";
      winBandText = "roughly 44–52 wins in expectation.";
    } else if (myRank <= 16) {
      tier = "fringe playoff / play-in team";
      winBandText = "roughly 38–46 wins in expectation.";
    } else if (myRank <= 22) {
      tier = "lottery team";
      winBandText = "roughly 32–40 wins in expectation.";
    } else {
      tier = "rebuild team";
      winBandText = "roughly 25–35 wins in expectation.";
    }
  }

  const impacts = myTeam
    .map((p) => p.impactScore)
    .sort((a, b) => a - b);
  const medianImpact =
    impacts.length === 0
      ? 0
      : impacts.length % 2
      ? impacts[Math.floor(impacts.length / 2)]
      : (impacts[impacts.length / 2 - 1] +
          impacts[impacts.length / 2]) /
        2;

  const groups = {
    Core: [],
    Rotation: [],
    Prospect: [],
    Trade: [],
    Cut: [],
  };

  myTeam.forEach((p) => {
    const cat = categorizePlayer(p, medianImpact);
    groups[cat].push(p);
  });

  const byImpactDesc = (arr) =>
    arr.slice().sort((a, b) => b.impactScore - a.impactScore);

  const core = byImpactDesc(groups.Core);
  const rotation = byImpactDesc(groups.Rotation);
  const prospects = byImpactDesc(groups.Prospect);
  const tradeChips = byImpactDesc(
    groups.Trade.filter((p) => p.Ovr >= 55)
  );
  const cutCandidates = byImpactDesc(groups.Cut);

  const listNames = (players, max = 4) =>
    players.slice(0, max).map((p) => p.Name).join(", ");

  const needShoot = shootingLabel === "Weak";
  const needDef = defLabel === "Weak";
  const needGuardDepth = myTeam.filter((p) => p.role === "G").length <= 2;
  const needBigDepth = myTeam.filter((p) => p.role === "B").length <= 2;

  const pickMatches = (source, filterFn, max = 3) =>
    source
      .filter(({ player }) => filterFn(player))
      .slice(0, max)
      .map(({ player }) => `${player.Name} (${player.Team})`)
      .join(", ");

  const tradeShooters = needShoot
    ? pickMatches(
        lastTradeTargets,
        (p) => p["3Pt"] >= 65 && p.Ovr >= 55
      )
    : "";
  const tradeDefenders = needDef
    ? pickMatches(
        lastTradeTargets,
        (p) => p.dIQ >= 65 && p.Reb >= 55
      )
    : "";
  const faGuards = needGuardDepth
    ? pickMatches(
        lastFreeAgentTargets,
        (p) => p.role === "G" && p.Ovr >= 55
      )
    : "";
  const faBigs = needBigDepth
    ? pickMatches(
        lastFreeAgentTargets,
        (p) => p.role === "B" && p.Ovr >= 55
      )
    : "";

  const topProspectsNames = listNames(prospects, 5);
  const topDraftNames = lastDraftProspects
    .slice(0, 4)
    .map(({ player }) => player.Name)
    .join(", ");

  const strengths = [];
  const weaknesses = [];

  if (shootingLabel === "Strong") strengths.push("perimeter shooting");
  if (playLabel === "Strong") strengths.push("playmaking");
  if (defLabel === "Strong") strengths.push("team defense");
  if (physLabel === "Strong") strengths.push("physicality / rebounding");

  if (shootingLabel === "Weak") weaknesses.push("perimeter shooting");
  if (playLabel === "Weak") weaknesses.push("ball handling / creation");
  if (defLabel === "Weak") weaknesses.push("defense");
  if (physLabel === "Weak") weaknesses.push("physicality / rebounding");

  const strengthsText = strengths.length
    ? strengths.join(", ")
    : "no clear standout strengths (overall balanced)";
  const weaknessesText = weaknesses.length
    ? weaknesses.join(", ")
    : "no glaring weaknesses (main improvements are marginal upgrades)";

  let html = `<div class="section-block">
    <h3>High-level plan</h3>
    <p>You currently project as a <strong>${tier}</strong>${
    myRank
      ? ` (rank ${myRank} of ${totalTeams}, ${winBandText})`
      : ""
  }</p>
    <p><strong>Team profile:</strong> strengths in ${strengthsText}; weaknesses in ${weaknessesText}. Avg age ${myAge.toFixed(
    1
  )} vs league ${allAge.toFixed(
    1
  )}; Pot–Ovr gap ${myPotGap.toFixed(1)} vs ${allPotGap.toFixed(
    1
  )}.</p>
  </div>`;

  html += `<div class="section-block">
    <h3>1) Clean up the bottom of the roster</h3>`;

  if (cutCandidates.length) {
    html += `<p><strong>Cut or salary-dump:</strong> ${listNames(
      cutCandidates,
      5
    )}. These players are either low-impact or older with limited upside.</p>`;
  } else {
    html += `<p>No obvious pure cut candidates based on current thresholds.</p>`;
  }

  if (tradeChips.length) {
    html += `<p><strong>Primary trade chips:</strong> ${listNames(
      tradeChips,
      5
    )}. These are decent players but not core pieces, and can be packaged for upgrades.</p>`;
  }

  html += `</div>`;

  html += `<div class="section-block">
    <h3>2) Targeted upgrades</h3>`;

  if (needShoot) {
    html += `<p><strong>Add shooting:</strong> prioritize guards/wings with 3Pt ≥ 65.`;
    if (tradeShooters) {
      html += ` Possible trade targets: ${tradeShooters}.`;
    }
    html += `</p>`;
  }

  if (needDef) {
    html += `<p><strong>Improve defense:</strong> look for bigs/wings with dIQ ≥ 65 and Reb ≥ 55.`;
    if (tradeDefenders) {
      html += ` Possible trade targets: ${tradeDefenders}.`;
    }
    html += `</p>`;
  }

  if (needGuardDepth) {
    html += `<p><strong>Guard depth:</strong> you have limited playable guards.`;
    if (faGuards) {
      html += ` Consider signing: ${faGuards}.`;
    } else {
      html += ` Use trades or the draft to add at least one solid rotation guard.`;
    }
    html += `</p>`;
  }

  if (needBigDepth) {
    html += `<p><strong>Big depth:</strong> you are light on bigs in your top 8.`;
    if (faBigs) {
      html += ` Consider signing: ${faBigs}.`;
    } else {
      html += ` Look to trade for or draft a rotation big with strength, rebounding, and defense.`;
    }
    html += `</p>`;
  }

  if (
    !needShoot &&
    !needDef &&
    !needGuardDepth &&
    !needBigDepth
  ) {
    html += `<p>Your main path to improvement is upgrading your weakest starter using the trade chips above for a higher-impact player (Ovr ≥ 60, impactScore above team median).</p>`;
  }

  html += `</div>`;

  html += `<div class="section-block">
    <h3>3) Develop and protect your prospects</h3>`;

  if (prospects.length) {
    html += `<p><strong>Key prospects to prioritize:</strong> ${topProspectsNames}. Avoid cutting or attaching them lightly in trades; they are your main internal upside.</p>`;
  } else {
    html += `<p>No strong internal prospects identified by the current rules (Pot ≥ 60 with headroom). The draft and trades are your main paths to long-term upside.</p>`;
  }

  if (lastDraftProspects.length) {
    html += `<p><strong>Draft focus:</strong> top prospects in your file include ${topDraftNames}. Use them as reference profiles: prioritize players with high potential and ratings that address your current weaknesses.</p>`;
  }

  html += `</div>`;

  container.innerHTML = html;
}

/* ---------- Helpers ---------- */

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function playerKey(p) {
  return `${p.Team}-${p.Name}-${p.Age}`;
}
