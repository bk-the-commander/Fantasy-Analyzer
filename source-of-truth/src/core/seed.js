/* Source of Truth — synthetic source systems.
 *
 * This file fabricates what six connected systems would hand us. It emits
 * *only* per-source records: there is deliberately no ground-truth roster in
 * the output. The application has to discover people the same way it would in
 * production — by resolving identities across systems — because a prototype
 * that quietly hands itself the right answer proves nothing.
 *
 * Every record is fictional. Names, IDs, domains and revenue figures are
 * generated; none of it corresponds to a real person or company.
 *
 * The dataset is deterministic: same seed, same world, every reload.
 */
(function (SOT) {
  'use strict';

  const DAY = 86400000;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIRST = ['Amara','Daniel','Priya','Marcus','Elena','Jonah','Keiko','Tobias','Ines','Rafael','Nadia','Curtis','Simone','Aditya','Bridget','Malik','Yuki','Hector','Colette','Devon','Rosa','Nils','Talia','Owen','Farrah','Emeka','Lucia','Grant','Anika','Peter','Sasha','Diego','Meredith','Isaac','Noor','Callum','Beatriz','Hugo','Tessa','Andre','Wren','Kofi','Marina','Silas','Juno','Ravi','Dahlia','Bennett','Solange','Theo','Ingrid','Omar','Cleo','Fintan','Zara','Leland','Mira','Gus','Paloma','Everett','Sunita','Bram','Odile','Kwame','Verity','Aurelio','Nell','Xander','Camila','Reuben','Astrid','Ismael','Greta','Dashiell','Lena','Corbin','Yara','Milo','Freya','Emmett','Rania','Soren','Josefina','Caleb','Delphine','Ruben','Maya','Alistair','Nia'];
  const LAST = ['Okonjo','Reyes','Chandra','Whitfield','Marchetti','Steinberg','Watanabe','Ferreira','Doyle','Alvarado','Haddad','Boone','Lefevre','Nair','Callahan','Osei','Tanaka','Delgado','Beaumont','Pritchard','Iglesias','Bergstrom','Mansour','Kilbride','Amari','Nwosu','Salcedo','Thorne','Rasmussen','Vance','Kovacs','Montoya','Ashford','Feldman','Rahimi','Sinclair','Cardoso','Lindqvist','Brannigan','Sarraf','Halloway','Mensah','Petrova','Wexler','Ibarra','Krishnan','Farrow','Ellsworth','Diallo','Grimaldi','Solberg','Nazari','Fontaine','Kearney','Bashir','Ardoin','Vasquez','Tremblay','Ocampo','Whitlock','Deshpande','Novak','Beauchamp','Adeyemi','Larkin','Costa','Hargrove','Ruiz','Stavros','Lindgren','Baptiste','Mueller','Quintero','Fairbanks','Ozturk','Cavanaugh','Rendon','Blackwood','Sagal','Ivanov','Duplessis','Achebe','Rowan','Villanueva','Strand','Moreau','Kaplan','Underhill','Bhatt'];

  const US_LOCATIONS = ['New York, NY','Boston, MA','Atlanta, GA','Chicago, IL','Austin, TX','Denver, CO','San Francisco, CA','Seattle, WA','Remote — US'];
  const EMEA_LOCATIONS = ['London, UK','Dublin, IE','Munich, DE','Amsterdam, NL','Remote — EMEA'];

  const ACCOUNT_PREFIX = ['Northwind','Vertex','Bluepeak','Harborline','Ironclad','Silverbrook','Anchorpoint','Kestrel','Brightfield','Foundry','Cobblestone','Meridian','Lakeshore','Ridgeway','Waypoint','Summit','Copperline','Elmgrove','Trailhead','Stonebridge','Bayard','Clearwater','Fenwick','Granite','Halcyon','Juniper','Kingsley','Larkspur','Mapleton','Norwood'];
  const ACCOUNT_SUFFIX = ['Logistics','Health','Financial','Manufacturing','Retail Group','Energy','Media','Insurance','Foods','Technologies','Industries','Partners','Systems','Labs','Holdings'];

  const STAGES = [
    { n: 1, name: '1 — Discovery', prob: 0.10 },
    { n: 2, name: '2 — Qualified', prob: 0.20 },
    { n: 3, name: '3 — Value Confirmed', prob: 0.40 },
    { n: 4, name: '4 — Proposal', prob: 0.60 },
    { n: 5, name: '5 — Negotiation', prob: 0.80 },
    { n: 6, name: '6 — Contracting', prob: 0.90 },
  ];

  /* ------------------------------------------------------------- org shape */

  const ORG_SPEC = [
    {
      bu: 'Global Sales',
      regions: [
        {
          region: 'Americas',
          locations: US_LOCATIONS,
          groups: [
            { segment: 'Enterprise', department: 'Enterprise Sales', director: 'Director, Enterprise Sales — Americas',
              teams: [
                { team: 'Northeast Enterprise', territory: 'Northeast', ics: 6 },
                { team: 'Southeast Enterprise', territory: 'Southeast', ics: 5 },
                { team: 'West Enterprise', territory: 'Pacific', ics: 6 },
              ] },
            { segment: 'Commercial', department: 'Commercial Sales', director: 'Director, Commercial Sales',
              teams: [
                { team: 'Central Commercial', territory: 'Central', ics: 6 },
                { team: 'West Commercial', territory: 'Mountain', ics: 6 },
              ] },
          ],
        },
        {
          region: 'EMEA',
          locations: EMEA_LOCATIONS,
          groups: [
            { segment: 'Enterprise', department: 'International Sales', director: 'Regional Vice President, EMEA',
              teams: [
                { team: 'UK & Ireland', territory: 'UK & Ireland', ics: 5 },
                { team: 'DACH', territory: 'DACH', ics: 4 },
              ] },
          ],
        },
      ],
    },
  ];

  const IC_TITLES = {
    'Enterprise Sales': ['Account Executive', 'Senior Account Executive', 'Enterprise Account Executive'],
    'Commercial Sales': ['Account Executive', 'Senior Account Executive'],
    'International Sales': ['Account Executive', 'Senior Account Executive', 'Enterprise Account Executive'],
  };

  const JOB_FAMILY = {
    'Account Executive': 'Sales — Field',
    'Senior Account Executive': 'Sales — Field',
    'Enterprise Account Executive': 'Sales — Field',
    'Solutions Engineer': 'Sales — Technical',
    'Sales Development Representative': 'Sales — Development',
    'Customer Success Manager': 'Customer Success',
    'Renewal Manager': 'Customer Success',
    'Revenue Operations Analyst': 'Operations',
    'Deal Desk Analyst': 'Operations',
  };

  function build(seedNum) {
    const rand = mulberry32(seedNum == null ? 20260809 : seedNum);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

    const asOf = Date.parse('2026-08-09T17:30:00Z');
    const company = {
      name: 'Cobalt Systems',
      domain: 'cobaltsystems.com',
      asOf,
      fiscalYearStart: Date.parse('2026-01-01T00:00:00Z'),
      quarter: { label: 'Q3 FY26', start: Date.parse('2026-07-01T00:00:00Z'), end: Date.parse('2026-09-30T23:59:59Z') },
    };

    /* ------------------------------------------------- an internal roster
     * Used only to *generate* the source records below, then discarded. The
     * engine never sees it.
     */
    const roster = [];
    const usedNames = new Set();
    let seq = 0;

    function newPerson(spec) {
      let first, last, key, guard = 0;
      do {
        first = pick(FIRST);
        last = pick(LAST);
        key = first + '.' + last;
        guard++;
      } while (usedNames.has(key) && guard < 200);
      usedNames.add(key);

      seq++;
      const p = Object.assign(
        {
          rid: 'r' + String(seq).padStart(3, '0'),
          first,
          last,
          name: first + ' ' + last,
          email: (first + '.' + last).toLowerCase().replace(/[^a-z.]/g, '') + '@' + company.domain,
          workerId: 'WD-1' + String(10000 + seq * 7).slice(-5),
          positionId: 'P-' + String(20000 + seq * 13).slice(-5),
          status: 'Active',
          workerType: 'Employee',
          hireDate: asOf - between(120, 2400) * DAY,
          terminationDate: null,
          quota: 0,
          reports: [],
        },
        spec
      );
      roster.push(p);
      return p;
    }

    // Executive
    const ceo = newPerson({
      title: 'Chief Executive Officer', jobFamily: 'Executive', department: 'Executive',
      businessUnit: 'Corporate', region: 'Americas', segment: 'Corporate', team: 'Executive',
      location: 'New York, NY', costCenter: 'CC-1000', managerRid: null, level: 0, territory: null,
      hireDate: asOf - between(2600, 3400) * DAY,
    });

    const cro = newPerson({
      title: 'Chief Revenue Officer', jobFamily: 'Executive', department: 'Executive',
      businessUnit: 'Global Sales', region: 'Americas', segment: 'Corporate', team: 'Revenue Leadership',
      location: 'New York, NY', costCenter: 'CC-2000', managerRid: ceo.rid, level: 1, territory: null,
      hireDate: asOf - between(900, 1800) * DAY,
    });

    // Global Sales
    ORG_SPEC[0].regions.forEach((reg) => {
      const rvp = reg.region === 'Americas'
        ? newPerson({
            title: 'Regional Vice President, Americas', jobFamily: 'Sales — Leadership', department: 'Enterprise Sales',
            businessUnit: 'Global Sales', region: reg.region, segment: 'Corporate', team: 'Americas Leadership',
            location: pick(reg.locations), costCenter: 'CC-2100', managerRid: cro.rid, level: 2, territory: null,
          })
        : null;

      reg.groups.forEach((grp) => {
        const parentRid = rvp ? rvp.rid : cro.rid;
        const director = newPerson({
          title: grp.director, jobFamily: 'Sales — Leadership', department: grp.department,
          businessUnit: 'Global Sales', region: reg.region, segment: grp.segment,
          team: reg.region + ' ' + grp.segment + ' Leadership',
          location: pick(reg.locations), costCenter: 'CC-21' + between(10, 99), managerRid: parentRid,
          level: 3, territory: null,
        });

        grp.teams.forEach((t) => {
          const mgr = newPerson({
            title: 'Manager, ' + grp.segment + ' Sales', jobFamily: 'Sales — Leadership', department: grp.department,
            businessUnit: 'Global Sales', region: reg.region, segment: grp.segment, team: t.team,
            location: pick(reg.locations), costCenter: 'CC-22' + between(10, 99), managerRid: director.rid,
            level: 4, territory: t.territory, quota: 0,
          });

          for (let i = 0; i < t.ics; i++) {
            const title = pick(IC_TITLES[grp.department]);
            newPerson({
              title, jobFamily: JOB_FAMILY[title], department: grp.department,
              businessUnit: 'Global Sales', region: reg.region, segment: grp.segment, team: t.team,
              location: pick(reg.locations), costCenter: mgr.costCenter, managerRid: mgr.rid,
              level: 5, territory: t.territory,
              quota: grp.segment === 'Enterprise' ? between(11, 18) * 100000 : between(6, 10) * 100000,
            });
          }

          if (grp.segment === 'Enterprise') {
            newPerson({
              title: 'Solutions Engineer', jobFamily: JOB_FAMILY['Solutions Engineer'], department: 'Sales Engineering',
              businessUnit: 'Global Sales', region: reg.region, segment: grp.segment, team: t.team,
              location: pick(reg.locations), costCenter: 'CC-2300', managerRid: mgr.rid, level: 5,
              territory: t.territory,
            });
          }
        });
      });
    });

    // Sales Development
    const sdrMgr = newPerson({
      title: 'Manager, Sales Development', jobFamily: 'Sales — Leadership', department: 'Sales Development',
      businessUnit: 'Global Sales', region: 'Americas', segment: 'Commercial', team: 'Sales Development',
      location: 'Austin, TX', costCenter: 'CC-2400', managerRid: cro.rid, level: 3, territory: null,
    });
    for (let i = 0; i < 8; i++) {
      newPerson({
        title: 'Sales Development Representative', jobFamily: JOB_FAMILY['Sales Development Representative'],
        department: 'Sales Development', businessUnit: 'Global Sales', region: 'Americas', segment: 'Commercial',
        team: 'Sales Development', location: pick(['Austin, TX', 'Chicago, IL', 'Remote — US']),
        costCenter: 'CC-2400', managerRid: sdrMgr.rid, level: 4, territory: pick(['Central', 'Mountain', 'Southeast']),
        quota: between(4, 7) * 10000,
      });
    }

    // Customer Success
    const vpCs = newPerson({
      title: 'Vice President, Customer Success', jobFamily: 'Customer Success', department: 'Customer Success',
      businessUnit: 'Customer Success', region: 'Americas', segment: 'Corporate', team: 'CS Leadership',
      location: 'Boston, MA', costCenter: 'CC-3000', managerRid: ceo.rid, level: 1, territory: null,
    });
    [
      { team: 'Onboarding', title: 'Customer Success Manager', dept: 'Customer Success', n: 5 },
      { team: 'Renewals', title: 'Renewal Manager', dept: 'Renewals', n: 6 },
    ].forEach((g) => {
      const mgr = newPerson({
        title: 'Manager, ' + g.team, jobFamily: 'Customer Success', department: g.dept,
        businessUnit: 'Customer Success', region: 'Americas', segment: 'Corporate', team: g.team,
        location: pick(US_LOCATIONS), costCenter: 'CC-30' + between(10, 99), managerRid: vpCs.rid, level: 2,
        territory: null,
      });
      for (let i = 0; i < g.n; i++) {
        newPerson({
          title: g.title, jobFamily: JOB_FAMILY[g.title], department: g.dept, businessUnit: 'Customer Success',
          region: 'Americas', segment: 'Corporate', team: g.team, location: pick(US_LOCATIONS),
          costCenter: mgr.costCenter, managerRid: mgr.rid, level: 3, territory: null,
          quota: g.title === 'Renewal Manager' ? between(20, 40) * 100000 : 0,
        });
      }
    });

    // Revenue Operations
    const srDirOps = newPerson({
      title: 'Senior Director, Revenue Operations', jobFamily: 'Operations', department: 'Revenue Operations',
      businessUnit: 'Revenue Operations', region: 'Americas', segment: 'Corporate', team: 'RevOps Leadership',
      location: 'Denver, CO', costCenter: 'CC-4000', managerRid: cro.rid, level: 2, territory: null,
    });
    [
      { team: 'Sales Operations', title: 'Revenue Operations Analyst', dept: 'Revenue Operations', n: 4 },
      { team: 'Deal Desk', title: 'Deal Desk Analyst', dept: 'Deal Desk', n: 3 },
    ].forEach((g) => {
      const mgr = newPerson({
        title: 'Manager, ' + g.team, jobFamily: 'Operations', department: g.dept,
        businessUnit: 'Revenue Operations', region: 'Americas', segment: 'Corporate', team: g.team,
        location: pick(US_LOCATIONS), costCenter: 'CC-40' + between(10, 99), managerRid: srDirOps.rid, level: 3,
        territory: null,
      });
      for (let i = 0; i < g.n; i++) {
        newPerson({
          title: g.title, jobFamily: JOB_FAMILY[g.title], department: g.dept, businessUnit: 'Revenue Operations',
          region: 'Americas', segment: 'Corporate', team: g.team, location: pick(US_LOCATIONS),
          costCenter: mgr.costCenter, managerRid: mgr.rid, level: 4, territory: null,
        });
      }
    });

    const byRid = Object.fromEntries(roster.map((p) => [p.rid, p]));
    roster.forEach((p) => { if (p.managerRid) byRid[p.managerRid].reports.push(p.rid); });

    /* ------------------------------------------------------- accounts / opps */

    const accounts = [];
    const opportunities = [];
    const sellers = roster.filter((p) => p.quota > 0 && p.department !== 'Sales Development');
    let accSeq = 0;
    let oppSeq = 0;

    sellers.forEach((p) => {
      const n = p.segment === 'Enterprise' ? between(6, 11) : between(10, 16);
      for (let i = 0; i < n; i++) {
        accSeq++;
        const acc = {
          id: '001' + String(500000 + accSeq * 37).slice(-9),
          name: pick(ACCOUNT_PREFIX) + ' ' + pick(ACCOUNT_SUFFIX),
          ownerRid: p.rid,
          segment: p.segment,
          territory: p.territory,
          arr: between(20, 400) * 1000,
          renewalDate: asOf + between(20, 400) * DAY,
        };
        accounts.push(acc);

        if (rand() < 0.8) {
          oppSeq++;
          const stage = STAGES[Math.min(5, Math.floor(Math.pow(rand(), 1.3) * 6))];
          const isEmea = p.region === 'EMEA';
          const currency = isEmea ? (p.team === 'DACH' ? 'EUR' : 'GBP') : 'USD';
          const amountLocal = (p.segment === 'Enterprise' ? between(150, 950) : between(50, 260)) * 1000;
          const daysOut = between(-10, 190);
          opportunities.push({
            id: '006' + String(700000 + oppSeq * 41).slice(-9),
            name: acc.name + ' — ' + pick(['Platform Expansion', 'New Business', 'Renewal + Uplift', 'Pilot Conversion', 'Multi-Year Renewal']),
            accountId: acc.id,
            ownerRid: p.rid,
            amountLocal,
            currency,
            stage: stage.n,
            stageName: stage.name,
            probability: stage.prob,
            closeDate: asOf + daysOut * DAY,
            recordType: rand() < 0.14 ? 'Renewal' : rand() < 0.4 ? 'Expansion' : 'New Business',
            createdDate: asOf - between(1, 260) * DAY,
            forecastCategory: stage.n >= 5 ? 'Commit' : stage.n >= 3 ? 'Best Case' : 'Pipeline',
          });
        }
      }
    });

    // A handful of deals booked into the current quarter in the last two days.
    // They exist in the CRM and in Clari, and cannot exist in a BI extract that
    // last refreshed on Thursday — which is most of why the dashboard is short.
    opportunities.filter((_, i) => i % 47 === 5).slice(0, 7).forEach((o) => {
      o.createdDate = asOf - between(0, 2) * DAY;
      o.closeDate = company.quarter.start + Math.floor(rand() * (company.quarter.end - company.quarter.start));
      if (o.stage < 2) { o.stage = 2; o.stageName = STAGES[1].name; o.probability = STAGES[1].prob; }
    });

    /* --------------------------------------------------------- sync state
     * Gong's connector has been failing for nine days. That is not decoration:
     * it makes every Gong disagreement classify as Lag rather than Divergence,
     * which is exactly the distinction the product is selling.
     */
    const syncState = {
      salesforce: { lastSync: asOf - 12 * 60000, status: 'healthy' },
      workday:    { lastSync: asOf - 8 * 3600000, status: 'healthy' },
      clari:      { lastSync: asOf - 41 * 60000, status: 'healthy' },
      gong:       { lastSync: asOf - 9 * DAY, status: 'degraded', message: 'OAuth token expired — refresh failed 214 times since Jul 31.' },
      tps:        { lastSync: asOf - 6 * DAY, status: 'healthy', message: 'Weekly batch. Next run Sunday 23:00 UTC.' },
      tableau:    { lastSync: asOf - 9 * 3600000, status: 'healthy' },
    };

    /* ------------------------------------------------------------ anomalies
     * Chosen by predicate rather than index so the narrative survives changes
     * to the generator. Each entry is also the demo's answer key.
     */
    const notes = [];
    const flags = {};
    function flag(p, kind, detail) {
      (flags[p.rid] || (flags[p.rid] = [])).push(kind);
      notes.push({ rid: p.rid, name: p.name, kind, detail });
    }

    // Individual contributors on a team: everyone on it who does not manage it.
    const icsByTeam = (team) => roster.filter((p) => p.team === team && p.managerRid && !/^Manager,/.test(p.title));
    const allIcs = roster.filter((p) => p.managerRid && !/^(Manager|Director|Senior Director|Regional Vice|Vice President|Chief)/.test(p.title));

    // 1. Terminated in Workday, still live in Salesforce and Gong.
    const terminated = [icsByTeam('Southeast Enterprise')[1], icsByTeam('Central Commercial')[2]].filter(Boolean);
    terminated.forEach((p) => {
      p.status = 'Terminated';
      p.terminationDate = asOf - between(18, 46) * DAY;
      p.sfdcStillActive = true;
      flag(p, 'ghost-access', 'Terminated in Workday; Salesforce user still active and owns live accounts.');
    });

    // 2. Reorg three days ago. Workday and the fast connectors know about it.
    //    Gong has not run since July, so it still describes the old team —
    //    which is lag, not disagreement, and must not be reported as a defect.
    const reorgTeam = icsByTeam('Northeast Enterprise').slice(0, 4);
    const newMgr = roster.find((p) => p.team === 'Southeast Enterprise' && p.level === 4);
    reorgTeam.forEach((p) => {
      p.priorManagerRid = p.managerRid;
      p.priorTeam = p.team;
      p.managerRid = newMgr.rid;
      p.team = newMgr.team;
      p.managerEffectiveFrom = asOf - 3 * DAY;
      p.staleInSlowSystems = true;
      flag(p, 'reorg-lag', 'Moved teams three days ago. Systems that have not re-read the record are behind, not wrong.');
    });

    // 3. Salesforce role hierarchy edited by hand — a genuine divergence.
    const sfdcMgrDrift = [
      icsByTeam('West Enterprise')[0], icsByTeam('West Enterprise')[3],
      icsByTeam('UK & Ireland')[1], icsByTeam('Central Commercial')[0],
      icsByTeam('Renewals')[2],
    ].filter(Boolean);
    sfdcMgrDrift.forEach((p) => {
      const candidates = roster.filter((q) => q.level === 4 && q.rid !== p.managerRid && q.businessUnit === p.businessUnit);
      p.sfdcManagerRid = candidates.length ? candidates[Math.floor(rand() * candidates.length)].rid : null;
      if (p.sfdcManagerRid) flag(p, 'manager-divergence', 'Salesforce role hierarchy points at a different manager than Workday.');
    });

    // 4. Territory conflicts. Planning system is the system of record; CRM drifted.
    const territoryDrift = [
      icsByTeam('Southeast Enterprise')[0], icsByTeam('West Commercial')[1], icsByTeam('West Commercial')[4],
      icsByTeam('DACH')[0], icsByTeam('Northeast Enterprise')[5], icsByTeam('Central Commercial')[3],
    ].filter(Boolean);
    const NEIGHBOURS = { Northeast: 'Mid-Atlantic', Southeast: 'Southeast — Gulf', Pacific: 'Pacific Northwest', Central: 'Great Lakes', Mountain: 'Pacific', 'UK & Ireland': 'Nordics', DACH: 'Central Europe' };
    territoryDrift.forEach((p) => {
      p.sfdcTerritory = NEIGHBOURS[p.territory] || 'Unassigned';
      flag(p, 'territory-conflict', 'Salesforce and Clari carry a territory the planning system never assigned.');
    });

    // 5. Position ID never written back to the CRM.
    const noPositionId = allIcs.filter((_, i) => i % 9 === 4).slice(0, 8);
    noPositionId.forEach((p) => { p.sfdcNoPositionId = true; flag(p, 'position-gap', 'Position ID is blank on the Salesforce user record.'); });

    // 6. Title drift between HRIS and CRM.
    const titleDrift = allIcs.filter((p) => p.title === 'Senior Account Executive').slice(0, 7);
    titleDrift.forEach((p) => { p.sfdcTitle = 'Account Executive'; flag(p, 'title-drift', 'Promotion recorded in Workday was never reflected in Salesforce.'); });

    // 7. Effective-dated promotions. Correctly NOT a conflict today.
    const scheduled = allIcs.filter((p) => p.title === 'Account Executive' && !p.sfdcTitle).slice(0, 3);
    scheduled.forEach((p) => {
      p.scheduledTitle = 'Senior Account Executive';
      p.scheduledFrom = Date.parse('2026-09-01T00:00:00Z');
      flag(p, 'scheduled-change', 'Promotion effective 1 Sep 2026. Not a discrepancy — a future-dated fact.');
    });

    // 8. Quota loaded into Clari before the CRM was updated.
    const quotaDrift = sellers.filter((_, i) => i % 11 === 3).slice(0, 5);
    quotaDrift.forEach((p) => {
      p.clariQuota = Math.round(p.quota * (rand() < 0.5 ? 1.15 : 0.9) / 5000) * 5000;
      flag(p, 'quota-conflict', 'Clari quota does not match the Salesforce quota record.');
    });

    // 9. Forecast hierarchy mapped to the wrong department.
    const deptDrift = allIcs.filter((_, i) => i % 13 === 6).slice(0, 4);
    deptDrift.forEach((p) => {
      p.clariDepartment = p.department === 'Enterprise Sales' ? 'Commercial Sales' : 'Enterprise Sales';
      flag(p, 'department-conflict', 'Clari forecast node rolls this person into the wrong department.');
    });

    // 10. Duplicate Salesforce user left behind by a rehire.
    const dupe = icsByTeam('UK & Ireland')[3];
    if (dupe) { dupe.duplicateSfdcUser = true; flag(dupe, 'duplicate-identity', 'Two active Salesforce users share this person\'s name and employee number.'); }

    // 11. Gong seat under a personal alias — matches on name only, low confidence.
    const aliasGong = [icsByTeam('West Enterprise')[2], icsByTeam('Onboarding')[1]].filter(Boolean);
    aliasGong.forEach((p) => {
      p.gongAlias = (p.first[0] + p.last).toLowerCase().replace(/[^a-z]/g, '') + '@' + company.domain;
      flag(p, 'weak-identity', 'Gong seat uses an email alias that does not match any HRIS record.');
    });

    // 12. Contractors: live CRM users with no worker record at all.
    const contractors = [
      { name: 'Priya Ellsworth', title: 'Account Executive (Contract)', team: 'Central Commercial', territory: 'Central', segment: 'Commercial' },
      { name: 'Hugo Lindqvist', title: 'Solutions Engineer (Contract)', team: 'West Enterprise', territory: 'Pacific', segment: 'Enterprise' },
    ];

    // 13. Orphan Gong seats nobody owns.
    const orphanGongSeats = [
      { name: 'Sales Demo Account', email: 'sales.demo@' + company.domain },
      { name: 'C. Rowan', email: 'crowan@' + company.domain },
    ];

    /* ------------------------------------------------ emit per-source records */

    const obs = (sys) => syncState[sys].lastSync;
    const mgrOf = (p) => (p.managerRid ? byRid[p.managerRid] : null);

    const workday = roster.map((p) => {
      const mgr = mgrOf(p);
      return {
        workerId: p.workerId,
        positionId: p.positionId,
        legalName: p.name,
        workEmail: p.email,
        jobTitle: p.title,
        jobProfile: p.jobFamily,
        supervisoryOrg: (mgr ? mgr.name + "'s Org" : 'Board of Directors'),
        managerWorkerId: mgr ? mgr.workerId : null,
        department: p.department,
        businessUnit: p.businessUnit,
        region: p.region,
        team: p.team,
        costCenter: p.costCenter,
        location: p.location,
        workerType: p.workerType,
        employmentStatus: p.status,
        hireDate: p.hireDate,
        terminationDate: p.terminationDate,
        managerEffectiveFrom: p.managerEffectiveFrom || p.hireDate,
        teamEffectiveFrom: p.managerEffectiveFrom || p.hireDate,
        scheduledChange: p.scheduledTitle
          ? { field: 'jobTitle', value: p.scheduledTitle, effectiveFrom: p.scheduledFrom }
          : null,
        observedAt: obs('workday'),
      };
    });

    let sfdcSeq = 0;
    const salesforce = [];
    roster.forEach((p) => {
      if (p.status === 'Terminated' && !p.sfdcStillActive) return;
      sfdcSeq++;
      const mgrRid = p.sfdcManagerRid || p.managerRid;
      const mgr = mgrRid ? byRid[mgrRid] : null;
      const rec = {
        userId: '0055f' + String(100000 + sfdcSeq * 17).slice(-6) + 'AB',
        name: p.name,
        email: p.email,
        title: p.sfdcTitle || p.title,
        userRoleName: p.level >= 4 ? p.team + ' — Rep' : p.team + ' — Leadership',
        managerUserId: null, // stitched below
        managerRid: mgr ? mgr.rid : null,
        territory: p.sfdcTerritory || p.territory || null,
        segment: p.segment,
        quotaAnnual: p.quota || null,
        isActive: p.status !== 'Terminated' || !!p.sfdcStillActive,
        profileName: p.level >= 4 ? 'Standard Sales User' : 'Sales Manager',
        employeeNumber: p.sfdcNoPositionId && rand() < 0.4 ? null : p.workerId,
        positionId: p.sfdcNoPositionId ? null : p.positionId,
        lastLogin: asOf - between(0, 14) * DAY,
        observedAt: obs('salesforce'),
        _rid: p.rid,
      };
      salesforce.push(rec);

      if (p.duplicateSfdcUser) {
        sfdcSeq++;
        salesforce.push(Object.assign({}, rec, {
          userId: '0055f' + String(100000 + sfdcSeq * 17).slice(-6) + 'AB',
          email: p.email.replace('@', '.old@'),
          title: 'Account Executive',
          territory: 'Unassigned',
          quotaAnnual: null,
          positionId: null,
          lastLogin: asOf - between(200, 400) * DAY,
          _duplicate: true,
        }));
      }
    });

    contractors.forEach((c, i) => {
      sfdcSeq++;
      const mgr = roster.find((p) => p.team === c.team && p.level === 4);
      salesforce.push({
        userId: '0055f' + String(100000 + sfdcSeq * 17).slice(-6) + 'AB',
        name: c.name,
        email: c.name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.') + '@' + company.domain,
        title: c.title,
        userRoleName: c.team + ' — Rep',
        managerUserId: null,
        managerRid: mgr ? mgr.rid : null,
        territory: c.territory,
        segment: c.segment,
        quotaAnnual: 400000 + i * 50000,
        isActive: true,
        profileName: 'Standard Sales User',
        employeeNumber: null,
        positionId: null,
        lastLogin: asOf - between(0, 3) * DAY,
        observedAt: obs('salesforce'),
        _rid: null,
        _contractor: true,
      });
      notes.push({ rid: null, name: c.name, kind: 'no-hr-record', detail: 'Active Salesforce user with no Workday worker record.' });
    });

    // Stitch Salesforce manager pointers now that every user has an ID.
    const sfdcByRid = {};
    salesforce.forEach((r) => { if (r._rid && !r._duplicate) sfdcByRid[r._rid] = r; });
    salesforce.forEach((r) => {
      if (r.managerRid && sfdcByRid[r.managerRid]) r.managerUserId = sfdcByRid[r.managerRid].userId;
      delete r.managerRid;
    });

    let clariSeq = 0;
    const clari = roster
      .filter((p) => p.status !== 'Terminated' && (p.quota > 0 || p.level <= 4))
      .map((p) => {
        clariSeq++;
        const clariMgr = mgrOf(p);
        return {
          userId: 'clari_' + (8800 + clariSeq * 3),
          email: p.email,
          name: p.name,
          forecastNode: (p.clariDepartment || p.department) + ' / ' + p.team,
          department: p.clariDepartment || p.department,
          managerEmail: clariMgr ? clariMgr.email : null,
          territory: p.sfdcTerritory || p.territory || null,
          quota: p.clariQuota || p.quota || null,
          observedAt: obs('clari'),
          _rid: p.rid,
        };
      });

    let gongSeq = 0;
    const gong = roster
      .filter((p) => p.quota > 0 || p.level <= 4)
      .map((p) => {
        gongSeq++;
        return {
          userId: 'gong-' + (55000 + gongSeq * 11),
          emailAddress: p.gongAlias || p.email,
          name: p.name,
          title: p.title,
          teamName: p.priorTeam || p.team,
          active: p.status !== 'Terminated' || !!p.sfdcStillActive,
          callsLast30: between(4, 62),
          meetingsLast30: between(2, 28),
          talkRatioPct: between(38, 71),
          lastActivity: asOf - between(0, 20) * DAY,
          observedAt: obs('gong'),
          _rid: p.rid,
        };
      });

    orphanGongSeats.forEach((s, i) => {
      gongSeq++;
      gong.push({
        userId: 'gong-' + (55000 + gongSeq * 11),
        emailAddress: s.email,
        name: s.name,
        title: null,
        teamName: 'Unassigned',
        active: true,
        callsLast30: i === 0 ? 0 : between(1, 6),
        meetingsLast30: 0,
        talkRatioPct: 0,
        lastActivity: asOf - between(30, 120) * DAY,
        observedAt: obs('gong'),
        _rid: null,
        _orphan: true,
      });
    });

    let tpsSeq = 0;
    const tps = roster
      .filter((p) => p.territory && p.status !== 'Terminated')
      .map((p) => {
        tpsSeq++;
        return {
          assignmentId: 'TA-' + (3300 + tpsSeq * 7),
          assigneeEmail: p.email,
          assigneeName: p.name,
          territoryName: p.territory,
          region: p.region,
          segment: p.segment,
          coverageModel: p.segment === 'Enterprise' ? 'Named Accounts' : 'Geographic',
          effectiveFrom: asOf - between(60, 400) * DAY,
          observedAt: obs('tps'),
          _rid: p.rid,
        };
      });

    let tabSeq = 0;
    const tableau = roster
      .filter((p) => p.level <= 4)
      .map((p) => {
        tabSeq++;
        return {
          siteUserId: 'tab-' + (900 + tabSeq * 5),
          email: p.email,
          name: p.name,
          siteRole: p.level <= 2 ? 'Creator' : p.level === 3 ? 'Explorer' : 'Viewer',
          lastLogin: asOf - between(0, 40) * DAY,
          observedAt: obs('tableau'),
          _rid: p.rid,
        };
      });

    // Record counts advertised on the Systems page: people plus their objects.
    const recordCounts = {
      salesforce: salesforce.length + accounts.length + opportunities.length,
      workday: workday.length * 3,
      clari: clari.length + opportunities.length,
      gong: gong.length + gong.length * 41,
      tps: tps.length + 24,
      tableau: tableau.length + 68,
    };

    return {
      company,
      hierarchy: SOT.model.DEFAULT_HIERARCHY,
      records: { workday, salesforce, clari, gong, tps, tableau },
      accounts,
      opportunities,
      syncState,
      recordCounts,
      notes,
      _rosterSize: roster.length,
      _ridIndex: byRid, // used only by the metric example to attribute pipeline
    };
  }

  SOT.seed = { build, mulberry32 };
})(window.SOT || (window.SOT = {}));
