// Marsa Maroc — Données réelles TCE & TC3 — 29-30/06/2026
const M = {
  date: "29-30/06/2026",
  navires: {
    total:32, accoste:4, attente:4, prevision:23, appareille:1,
    liste: [
      {n:"BILBAO TRADER",s:"Appareillé",t:"",a:"MSC GENEVE",l:"147",eta:"",acc:"28/06 10:30",app:"29/06 12:15"},
      {n:"CIELO DI RABAT",s:"Accosté",t:"TC3",a:"D'AMICO",l:"207",eta:"",acc:"28/06 19:30",app:""},
      {n:"MSC ATLANTIC III",s:"Accosté",t:"TC3",a:"MSC GENEVE",l:"",eta:"",acc:"28/06 10:00",app:""},
      {n:"CORELLI",s:"Accosté",t:"TC3",a:"ARKAS",l:"150",eta:"",acc:"30/06 05:30",app:""},
      {n:"WU ZHOU GLORY",s:"Accosté",t:"TCE",a:"MARSHIPPING",l:"163",eta:"",acc:"29/06 16:00",app:""},
      {n:"AKNOUL",s:"Attente",t:"TCE",a:"CMA CGM",l:"190",eta:"29/06 23:00",acc:"30/06 05:30",app:""},
      {n:"MSC MANZANILLO V",s:"Attente",t:"TC3",a:"MSC GENEVE",l:"366",eta:"30/06 11:00",acc:"30/06 16:30",app:""},
      {n:"ANDREA",s:"Attente",t:"TCE",a:"XPRESS",l:"185",eta:"30/06 04:00",acc:"30/06 09:30",app:""},
      {n:"MSC CLAUDIA",s:"Attente",t:"TCE",a:"MSC GENEVE",l:"270",eta:"30/06 04:00",acc:"30/06 12:00",app:""},
      {n:"GRANDE SAN PAOLO",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"01/07 06:30",acc:"",app:""},
      {n:"GRANDE SIERRA LEONE",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"01/07 05:00",acc:"",app:""},
      {n:"TEOS",s:"Prévision",t:"",a:"TRANSINSULAR",l:"100",eta:"01/07 05:30",acc:"",app:""},
      {n:"MONTPELLIER",s:"Prévision",t:"",a:"OOCL",l:"294",eta:"01/07 13:00",acc:"",app:""},
      {n:"ECO PONENTE",s:"Prévision",t:"",a:"XPRESS",l:"147",eta:"01/07 23:00",acc:"",app:""},
      {n:"GRANDE ANGOLA",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"02/07 00:30",acc:"",app:""},
      {n:"TANGER A",s:"Prévision",t:"",a:"ARKAS",l:"139",eta:"02/07 02:00",acc:"",app:""},
      {n:"X-PRESS SOUSSE",s:"Prévision",t:"",a:"XPRESS",l:"147",eta:"02/07 05:30",acc:"",app:""},
      {n:"LORRAINE",s:"Prévision",t:"",a:"",l:"294",eta:"02/07 06:00",acc:"",app:""},
      {n:"MAERSK NEWARK",s:"Prévision",t:"",a:"MAERSK",l:"366",eta:"02/07 13:00",acc:"",app:""},
      {n:"PAGE",s:"Prévision",t:"",a:"HAPAG",l:"366",eta:"02/07 15:00",acc:"",app:""},
      {n:"GRASMERE MAERSK",s:"Prévision",t:"",a:"MAERSK",l:"294",eta:"02/07 19:00",acc:"",app:""},
      {n:"MSC RADIANT III",s:"Prévision",t:"",a:"MSC GENEVE",l:"270",eta:"02/07 23:00",acc:"",app:""},
      {n:"GRANDE GABON",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"03/07 04:00",acc:"",app:""},
      {n:"MSC SARAH V",s:"Prévision",t:"",a:"MSC GENEVE",l:"300",eta:"03/07 10:30",acc:"",app:""},
      {n:"GRANDE GUINEA",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"03/07 11:00",acc:"",app:""},
      {n:"MSC ZONDA III",s:"Prévision",t:"",a:"MSC GENEVE",l:"270",eta:"03/07 13:30",acc:"",app:""},
      {n:"MSC RITA V",s:"Prévision",t:"",a:"MSC GENEVE",l:"270",eta:"04/07 02:30",acc:"",app:""},
      {n:"NORA MAERSK",s:"Prévision",t:"",a:"MAERSK",l:"366",eta:"04/07 03:30",acc:"",app:""},
      {n:"GRANDE TOGO",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"04/07 04:30",acc:"",app:""},
      {n:"GRANDE NIGERIA",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"04/07 16:00",acc:"",app:""},
      {n:"GRANDE SENEGAL",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"04/07 22:00",acc:"",app:""},
      {n:"GRANDE LUANDA",s:"Prévision",t:"",a:"GRIMALDI",l:"199",eta:"05/07 00:30",acc:"",app:""}
    ]
  },
  flux: {
    tce:{s1:{pi:235,vi:75,pe:49,ve:269,tot:628},s2:{pi:356,vi:118,pe:113,ve:288,tot:875},s3:{pi:37,vi:31,pe:56,ve:32,tot:156},
      tot:{pi:628,vi:224,pe:218,ve:589,tot:1659}},
    tc3:{s1:{pi:223,vi:26,pe:10,ve:312,tot:571},s2:{pi:364,vi:16,pe:50,ve:276,tot:706},s3:{pi:65,vi:9,pe:13,ve:15,tot:102},
      tot:{pi:652,vi:51,pe:73,ve:603,tot:1379}},
    global:{pi:1280,vi:275,pe:291,ve:1192,tot:3038}
  },
  livraison: {
    tce:{tot:636,moy:68.5,med:61.7,p95:119.9,
      lignes:[{l:"MAE",m:64.4,c:197},{l:"ARKAS",m:73.6,c:115},{l:"CMACGM",m:66.3,c:87},{l:"COSMO",m:67.8,c:85},{l:"IMAGESA",m:73.7,c:78},{l:"MARMEDS",m:70.3,c:38},{l:"ONE",m:63.2,c:12},{l:"GLOBCA",m:81.3,c:8},{l:"U-M-M",m:71.6,c:8},{l:"GLOBEMA",m:47.2,c:6},{l:"MSCMAR",m:87.7,c:2}],
      dims:{"20":178,"40":451,"45":7}},
    tc3:{tot:656,moy:92.9,med:81.5,p95:203.1,
      lignes:[{l:"MSCMAR",m:91.3,c:375},{l:"IMAGESA",m:97.0,c:121},{l:"ARKAS",m:100.0,c:45},{l:"ONE",m:86.5,c:34},{l:"U-M-M",m:94.2,c:32},{l:"MAE",m:90.8,c:28},{l:"COSMO",m:91.5,c:16},{l:"GLOBCA",m:116.9,c:3},{l:"BABMARS",m:4.4,c:1},{l:"MARMEDS",m:146.1,c:1}],
      dims:{"20":254,"40":399,"45":3}}
  },
  alertes: [
    {id:1,n:"critique",t:"Délai TC3 supérieur à l'objectif",d:"Le temps moyen de séjour camion au TC3 est de 92.9 min contre 68.5 min au TCE (+35.6%).",term:"TC3",h:"06:00",dt:"30/06"},
    {id:2,n:"critique",t:"P95 TC3 critique: 203.1 min",d:"5% des camions au TC3 attendent plus de 3h20. Seuil acceptable: 120 min.",term:"TC3",h:"06:00",dt:"30/06"},
    {id:3,n:"avertissement",t:"Dominance MSC au TC3 (57%)",d:"375 conteneurs MSCMAR sur 656 au TC3 (57% du trafic). Concentration élevée.",term:"TC3",h:"06:00",dt:"30/06"},
    {id:4,n:"avertissement",t:"Shift 3 faible: 258 conteneurs",d:"Le shift 3 ne traite que 8.5% du total (vs 52% pour le shift 2).",term:"Tous",h:"06:00",dt:"29/06"},
    {id:5,n:"info",t:"3,038 conteneurs traités (29/06)",d:"TCE: 1,659 | TC3: 1,379 | Import: 1,555 | Export: 1,483",term:"Tous",h:"08:16",dt:"29/06"},
    {id:6,n:"info",t:"32 navires programmés",d:"4 accostés, 4 en attente, 23 en prévision, 1 appareillé.",term:"Tous",h:"06:00",dt:"30/06"}
  ],
  iaResponses: {
    "resume": "<b>Résumé Marsa Maroc — 29-30/06/2026</b><br><br>🚢 <b>NAVIRES</b> : 32 au total (4 accostés, 4 attente, 23 prévision, 1 appareillé)<br>🚛 <b>FLUX</b> : 3,038 conteneurs (TCE: 1,659 | TC3: 1,379)<br>📦 <b>LIVRAISON</b> : 1,292 conteneurs import (TCE: 68.5min | TC3: 92.9min)<br>⚠️ <b>ALERTES</b> : TC3 est 1.4x plus lent que TCE, P95 TC3 = 203min",
    "delai": "<b>Délais livraison import :</b><br><table class='w-full text-sm'><tr class='border-b border-gray-600'><th></th><th class='text-center'>TCE</th><th class='text-center'>TC3</th><th class='text-center'>Delta</th></tr><tr><td>Conteneurs</td><td class='text-center text-blue-400'>636</td><td class='text-center text-orange-400'>656</td><td class='text-center'>+20</td></tr><tr><td>Moyenne</td><td class='text-center text-green-400'>68.5 min</td><td class='text-center text-red-400'>92.9 min</td><td class='text-center text-red-400'>+24.4</td></tr><tr><td>Médiane</td><td class='text-center'>61.7 min</td><td class='text-center'>81.5 min</td><td class='text-center text-red-400'>+19.8</td></tr><tr><td>P95</td><td class='text-center text-green-400'>119.9 min</td><td class='text-center text-red-400'>203.1 min</td><td class='text-center text-red-400'>+83.2</td></tr></table>",
    "flux": "<b>Flux camions 29/06/2026 :</b><br><table class='w-full text-sm'><tr class='border-b border-gray-600'><th></th><th class='text-center'>TCE</th><th class='text-center'>TC3</th><th class='text-center'>TOTAL</th></tr><tr><td>TC plein import</td><td class='text-center text-blue-400'>628</td><td class='text-center text-orange-400'>652</td><td class='text-center font-bold'>1,280</td></tr><tr><td>TC vide import</td><td class='text-center text-blue-400'>224</td><td class='text-center text-orange-400'>51</td><td class='text-center font-bold'>275</td></tr><tr><td>TC plein export</td><td class='text-center text-blue-400'>218</td><td class='text-center text-orange-400'>73</td><td class='text-center font-bold'>291</td></tr><tr><td>TC vide export</td><td class='text-center text-blue-400'>589</td><td class='text-center text-orange-400'>603</td><td class='text-center font-bold'>1,192</td></tr><tr class='border-t border-gray-600'><td class='font-bold'>TOTAL</td><td class='text-center font-bold text-blue-400'>1,659</td><td class='text-center font-bold text-orange-400'>1,379</td><td class='text-center font-bold text-green-400'>3,038</td></tr></table><br>Par shift : S1: 1,199 | S2: 1,581 | S3: 258",
    "navire": "<b>Navires accostés (4) :</b><br>⚓ CIELO DI RABAT (TC3, D'AMICO, 207m)<br>⚓ MSC ATLANTIC III (TC3, MSC)<br>⚓ CORELLI (TC3, ARKAS, 150m)<br>⚓ WU ZHOU GLORY (TCE, MARSHIPPING, 163m)<br><br><b>En attente (4) :</b><br>⏳ AKNOUL (TCE, CMA CGM, 190m)<br>⏳ MSC MANZANILLO V (TC3, MSC, 366m)<br>⏳ ANDREA (TCE, XPRESS, 185m)<br>⏳ MSC CLAUDIA (TCE, MSC, 270m)<br><br><b>Prévus aujourd'hui :</b><br>📅 GRANDE SAN PAOLO — 01/07 06:30<br>📅 GRANDE SIERRA LEONE — 01/07 05:00<br>📅 TEOS — 01/07 05:30<br>📅 MONTPELLIER — 01/07 13:00"
  }
};
