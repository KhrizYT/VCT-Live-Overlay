async function getRunningMatches() {
  return [
    {
      id: "demo-prx-ns",
      status: "running",
      bestOf: 3,
      event: "VCT 2026: Pacific Stage 2",
      stage: "Playoffs · Upper Round 1",
      tournament: "Playoffs",
      serie: "Pacific Stage 2",
      mapName: "Map 1",
      eventLogo: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%27320%27%20height%3D%27120%27%20viewBox%3D%270%200%20320%20120%27%3E%0A%20%20%20%20%3Crect%20width%3D%27320%27%20height%3D%27120%27%20rx%3D%2718%27%20fill%3D%27%235fd5e8%27/%3E%0A%20%20%20%20%3Ctext%20x%3D%27160%27%20y%3D%2770%27%20text-anchor%3D%27middle%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2734%27%20font-weight%3D%27700%27%20fill%3D%27%23062229%27%3EPACIFIC%3C/text%3E%0A%20%20%20%20%3C/svg%3E",
      seriesScore: [0, 0],
      roundScore: [7, 5],
      teams: [
        { id: "prx", name: "Paper Rex", acronym: "PRX", logo: "" },
        { id: "ns", name: "Nongshim RedForce", acronym: "NS", logo: "" }
      ]
    },
    {
      id: "demo-ge-krx",
      status: "running",
      bestOf: 3,
      event: "VCL 2026: LATAM Norte ACE League",
      stage: "Playoffs · Lower Round 2",
      tournament: "Playoffs",
      serie: "ACE League",
      mapName: "Map 2",
      eventLogo: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%27320%27%20height%3D%27120%27%20viewBox%3D%270%200%20320%20120%27%3E%0A%20%20%20%20%3Crect%20width%3D%27320%27%20height%3D%27120%27%20rx%3D%2718%27%20fill%3D%27%233577ff%27/%3E%0A%20%20%20%20%3Ctext%20x%3D%27160%27%20y%3D%2770%27%20text-anchor%3D%27middle%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2734%27%20font-weight%3D%27700%27%20fill%3D%27%23f8fbff%27%3EACE%20LEAGUE%3C/text%3E%0A%20%20%20%20%3C/svg%3E",
      seriesScore: [1, 0],
      roundScore: [4, 8],
      teams: [
        { id: "ge", name: "Global Esports", acronym: "GE", logo: "" },
        { id: "krx", name: "KIWOOM DRX", acronym: "KRX", logo: "" }
      ]
    },
    {
      id: "demo-gc",
      status: "running",
      bestOf: 3,
      event: "Game Changers 2026: Brazil Finals",
      stage: "Main Event · Upper Final",
      tournament: "Main Event",
      serie: "Brazil Finals",
      mapName: "Map 1",
      eventLogo: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%27320%27%20height%3D%27120%27%20viewBox%3D%270%200%20320%20120%27%3E%0A%20%20%20%20%3Crect%20width%3D%27320%27%20height%3D%27120%27%20rx%3D%2718%27%20fill%3D%27%23ff8c4f%27/%3E%0A%20%20%20%20%3Ctext%20x%3D%27160%27%20y%3D%2770%27%20text-anchor%3D%27middle%27%20font-family%3D%27Arial%2C%20Helvetica%2C%20sans-serif%27%20font-size%3D%2734%27%20font-weight%3D%27700%27%20fill%3D%27%232d1100%27%3EGAME%20CHANGERS%3C/text%3E%0A%20%20%20%20%3C/svg%3E",
      seriesScore: [0, 0],
      roundScore: [2, 3],
      teams: [
        { id: "mibrgc", name: "MIBR GC", acronym: "MIBR", logo: "" },
        { id: "tlbr", name: "Team Liquid Brazil", acronym: "TL", logo: "" }
      ]
    }
  ];
}

module.exports = { getRunningMatches };
