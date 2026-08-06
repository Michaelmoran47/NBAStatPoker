// Static reference data for the game: the player pool, the stat categories that can be
// dealt, and the "suit" pairs used for Flush-style combos.
//
// This module has no dependencies and no side effects — safe to import from both the
// browser client and (later) a Node game server, so the two never disagree about what
// a "Career Points" card is worth.

// Approximate career regular-season stats (mock/rounded for gameplay, not exact box-score accurate).
export const POOL = [
  {name:"LeBron James", pos:"SF", games:1492, points:41000, rebounds:11400, assists:11000, steals:2200, blocks:1100, threes:2300, ppg:27.1, rpg:7.5, apg:7.3},
  {name:"Michael Jordan", pos:"SG", games:1072, points:32292, rebounds:6672, assists:5633, steals:2514, blocks:893, threes:581, ppg:30.1, rpg:6.2, apg:5.3},
  {name:"Kareem Abdul-Jabbar", pos:"C", games:1560, points:38387, rebounds:17440, assists:5660, steals:1160, blocks:3189, threes:1, ppg:24.6, rpg:11.2, apg:3.6},
  {name:"Wilt Chamberlain", pos:"C", games:1045, points:31419, rebounds:23924, assists:4643, steals:80, blocks:120, threes:0, ppg:30.1, rpg:22.9, apg:4.4},
  {name:"Bill Russell", pos:"C", games:963, points:14522, rebounds:21620, assists:4100, steals:60, blocks:100, threes:0, ppg:15.1, rpg:22.5, apg:4.3},
  {name:"Magic Johnson", pos:"PG", games:906, points:17707, rebounds:6559, assists:10141, steals:1724, blocks:374, threes:431, ppg:19.5, rpg:7.2, apg:11.2},
  {name:"Larry Bird", pos:"SF", games:897, points:21791, rebounds:8974, assists:5695, steals:1556, blocks:755, threes:649, ppg:24.3, rpg:10.0, apg:6.3},
  {name:"Kobe Bryant", pos:"SG", games:1346, points:33643, rebounds:5640, assists:6306, steals:1944, blocks:640, threes:1827, ppg:25.0, rpg:5.2, apg:4.7},
  {name:"Tim Duncan", pos:"PF", games:1392, points:26496, rebounds:15091, assists:4225, steals:1025, blocks:3020, threes:15, ppg:19.0, rpg:10.8, apg:3.0},
  {name:"Shaquille O'Neal", pos:"C", games:1207, points:28596, rebounds:13099, assists:3026, steals:739, blocks:2732, threes:1, ppg:23.7, rpg:10.9, apg:2.5},
  {name:"Hakeem Olajuwon", pos:"C", games:1238, points:26946, rebounds:13748, assists:3058, steals:2162, blocks:3830, threes:20, ppg:21.8, rpg:11.1, apg:2.5},
  {name:"Karl Malone", pos:"PF", games:1476, points:36928, rebounds:14968, assists:5248, steals:1500, blocks:1120, threes:85, ppg:25.0, rpg:10.1, apg:3.6},
  {name:"John Stockton", pos:"PG", games:1504, points:19711, rebounds:4051, assists:15806, steals:3265, blocks:39, threes:845, ppg:13.1, rpg:2.7, apg:10.5},
  {name:"Kevin Garnett", pos:"PF", games:1462, points:26071, rebounds:14662, assists:5445, steals:1859, blocks:2037, threes:224, ppg:17.8, rpg:10.0, apg:3.7},
  {name:"Dirk Nowitzki", pos:"PF", games:1522, points:31560, rebounds:11489, assists:3651, steals:979, blocks:1215, threes:1982, ppg:20.7, rpg:7.5, apg:2.4},
  {name:"Steve Nash", pos:"PG", games:1217, points:17387, rebounds:3140, assists:10335, steals:730, blocks:78, threes:1685, ppg:14.3, rpg:2.6, apg:8.5},
  {name:"Allen Iverson", pos:"PG", games:914, points:24368, rebounds:3394, assists:5624, steals:1983, blocks:210, threes:979, ppg:26.7, rpg:3.7, apg:6.2},
  {name:"Kevin Durant", pos:"SF", games:1080, points:29900, rebounds:7300, assists:4400, steals:940, blocks:1180, threes:2150, ppg:27.2, rpg:6.7, apg:4.1},
  {name:"Stephen Curry", pos:"PG", games:950, points:24500, rebounds:4700, assists:6100, steals:1350, blocks:130, threes:3800, ppg:25.5, rpg:4.9, apg:6.4},
  {name:"Chris Paul", pos:"PG", games:1300, points:21900, rebounds:4900, assists:12300, steals:2400, blocks:130, threes:2100, ppg:17.0, rpg:4.5, apg:9.5},
  {name:"James Harden", pos:"SG", games:1100, points:26000, rebounds:5700, assists:7700, steals:1450, blocks:500, threes:2900, ppg:24.5, rpg:5.4, apg:7.2},
  {name:"Russell Westbrook", pos:"PG", games:1200, points:25000, rebounds:8100, assists:8700, steals:1750, blocks:250, threes:1450, ppg:21.9, rpg:6.9, apg:8.4},
  {name:"Giannis Antetokounmpo", pos:"PF", games:780, points:17800, rebounds:7300, assists:3600, steals:800, blocks:900, threes:500, ppg:23.1, rpg:9.4, apg:4.6},
  {name:"Nikola Jokic", pos:"C", games:700, points:15500, rebounds:6900, assists:5100, steals:700, blocks:500, threes:700, ppg:22.6, rpg:10.1, apg:7.3},
  {name:"Dwyane Wade", pos:"SG", games:1054, points:23165, rebounds:4966, assists:5785, steals:1638, blocks:782, threes:550, ppg:22.0, rpg:4.7, apg:5.4},
  {name:"Dwight Howard", pos:"C", games:1242, points:17825, rebounds:14627, assists:1273, steals:913, blocks:1935, threes:6, ppg:14.4, rpg:11.8, apg:1.0},
  {name:"Carmelo Anthony", pos:"SF", games:1260, points:28289, rebounds:6798, assists:2761, steals:1043, blocks:460, threes:2101, ppg:22.5, rpg:6.2, apg:2.7},
  {name:"Ray Allen", pos:"SG", games:1300, points:24505, rebounds:5272, assists:4361, steals:1451, blocks:265, threes:2973, ppg:18.9, rpg:4.1, apg:3.4},
  {name:"Reggie Miller", pos:"SG", games:1389, points:25279, rebounds:4489, assists:4141, steals:1503, blocks:306, threes:2560, ppg:18.2, rpg:3.0, apg:3.0},
  {name:"Scottie Pippen", pos:"SF", games:1178, points:18940, rebounds:7494, assists:6135, steals:2307, blocks:838, threes:1052, ppg:16.1, rpg:6.4, apg:5.2},
  {name:"Charles Barkley", pos:"PF", games:1073, points:23757, rebounds:12546, assists:4215, steals:1648, blocks:1032, threes:538, ppg:22.1, rpg:11.7, apg:3.9},
  {name:"Patrick Ewing", pos:"C", games:1183, points:24815, rebounds:11607, assists:1745, steals:913, blocks:2894, threes:10, ppg:21.0, rpg:9.8, apg:1.9}
].map((p,i)=>({...p, id:i}));

export const CATS = [
  {key:'points', label:'Career Points', icon:'🏀', fmt:v=>v.toLocaleString()},
  {key:'rebounds', label:'Career Rebounds', icon:'💪', fmt:v=>v.toLocaleString()},
  {key:'assists', label:'Career Assists', icon:'🎯', fmt:v=>v.toLocaleString()},
  {key:'games', label:'Games Played', icon:'📅', fmt:v=>v.toLocaleString()},
  {key:'ppg', label:'Pts / Game', icon:'🔥', fmt:v=>v.toFixed(1)},
  {key:'rpg', label:'Reb / Game', icon:'📊', fmt:v=>v.toFixed(1)},
  {key:'apg', label:'Ast / Game', icon:'🤝', fmt:v=>v.toFixed(1)},
  {key:'steals', label:'Career Steals', icon:'🕵️', fmt:v=>v.toLocaleString()},
  {key:'blocks', label:'Career Blocks', icon:'🚫', fmt:v=>v.toLocaleString()},
  {key:'threes', label:'Career 3PM', icon:'💦', fmt:v=>v.toLocaleString()}
];

// "Suits" — career/per-game pairs. Winning BOTH categories in a pair (when both happen
// to be in play for the hand) triggers a Flush-style bonus, same way suited cards do.
export const FAMILY_PAIRS = [
  {name:'Scoring Flush', keys:['points','ppg']},
  {name:'Rebounding Flush', keys:['rebounds','rpg']},
  {name:'Playmaking Flush', keys:['assists','apg']}
];
