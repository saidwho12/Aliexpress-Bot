const currencyList = {
  AED:["UAE","Dirham","Dirhams",784,"د.إ.","د.إ.","Fils","Fils",2,2,100],
  AFN:["Afghan","Afghani","Afghani",971,"Af","؋","Pul","Pul",2,2,100],
  ALL:["Albanian","Lek","Lekë",8,"L","L","Qindarka","Qindarka",2,2,100],
  AMD:["Armenian","Dram","Dram",51,"֏","դր","Luma","Luma",2,2,100],
  ANG:["Netherlands Antillean","Guilder","Guilders",532,"ƒ","ƒ","Cent","Cents",2,2,100],
  AOA:["Angolan","Kwanza","Kwanza",973,"Kz","Kz","Centimo","Centimos",2,2,100],
  ARS:["Argentine","Peso","Pesos",32,"AR$","$","Centavo","Centavos",2,2,100],
  AUD:["Australian","Dollar","Dollars",36,"AU$","$","Cent","Cents",2,2,100],
  AWG:["Aruban","Florin","Florin",533,"ƒ","ƒ","Cent","Cents",2,2,100],
  AZN:["Azerbaijani","Manat","Manat",944,"ман","₼","Qapik","Qapik",2,2,100],
  BAM:["Bosnia-Herzegovina","Convertible Mark","Marks",977,"KM","КМ","Fening","Fening",2,2,100],
  BBD:["Barbadian","Dollar","Dollars",52,"BBD$","$","Cent","Cents",2,2,100],
  BDT:["Bangladeshi","Taka","Taka",50,"৳","৳","Poisha","Poisha",2,2,100],
  BGN:["Bulgarian","Lev","Leva",975,"лв.","лв.","Stotinka","Stotinki",2,2,100],
  BHD:["Bahraini","Dinar","Dinars",48,"BD","د.ب.","Fils","Fils",3,3,1000],
  BIF:["Burundian","Franc","Francs",108,"FBu","FBu","Centime","Centimes",0,2,100],
  BMD:["Bermudian","Dollar","Dollars",60,"$","$","Cent","Cents",2,2,100],
  BND:["Brunei","Dollar","Dollars",96,"B$","$","Cent","Cents",2,2,100],
  BOB:["Bolivian","Boliviano","Bolivianos",68,"Bs.","Bs.","Centavo","Centavos",2,2,100],
  BRL:["Brazilian","Real","Reais",986,"R$","R$","Centavo","Centavos",2,2,100],
  BSD:["Bahamian","Dollar","Dollars",44,"$","$","Cent","Cents",2,2,100],
  BTN:["Bhutanese","Ngultrum","Ngultrums",64,"Nu.","Nu.","Chetrum","Chetrums",2,2,100],
  BWP:["Botswana","Pula","Pula",72,"P","P","Thebe","Thebe",2,2,100],
  BYN:["Belarusian","Ruble","Rubles",933,"Br","руб.","Kapiejka","Kapiejka",2,2,100],
  BZD:["Belize","Dollar","Dollars",84,"BZ$","$","Cent","Cents",2,2,100],
  CAD:["Canadian","Dollar","Dollars",124,"CA$","$","Cent","Cents",2,2,100],
  CDF:["Congolese","Franc","Francs",976,"FC","₣","Centime","Centimes",2,2,100],
  CHF:["Swiss","Franc","Francs",756,"Fr.","₣","Centime","Centimes",2,2,100],
  CKD:["Cook Islands","Dollar","Dollars",null,"$","$","Cent","Cents",2,2,100],
  CLP:["Chilean","Peso","Pesos",152,"CL$","$","Centavo","Centavos",0,0,100],
  CNY:["Chinese","Yuan","Yuan",156,"CN¥","¥元","Fen","Fen",2,2,100],
  COP:["Colombian","Peso","Pesos",170,"CO$","$","Centavo","Centavos",2,2,100],
  CRC:["Costa Rican","Colón","Colones",188,"₡","₡","Centimo","Centimos",2,2,100],
  CUC:["Cuban Convertible","Peso","Pesos",931,"CUC$","$","Centavo","Centavos",2,2,100],
  CUP:["Cuban","Peso","Pesos",192,"$MN","₱","Centavo","Centavos",2,2,100],
  CVE:["Cabo Verdean","Escudo","Escudo",132,"CV$","$","Centavo","Centavos",2,2,100],
  CZK:["Czech","Koruna","Koruny",203,"Kč","Kč","Haléř","Haléř",2,2,100],
  DJF:["Djiboutian","Franc","Francs",262,"Fdj","ف.ج.","Centime","Centimes",0,2,100],
  DKK:["Danish","Krone","Kroner",208,"kr.","kr.","Øre","Øre",2,2,100],
  DOP:["Dominican","Peso","Pesos",214,"RD$","$","Centavo","Centavos",2,2,100],
  DZD:["Algerian","Dinar","Dinars",12,"DA","د.ج.","Santeem","Santeems",2,2,100],
  EGP:["Egyptian","Pound","Pounds",818,"E£","ج.م.","Qirsh","Qirsh",2,2,100],
  EHP:["Sahrawi","Peseta","Pesetas",null,"Ptas.","Ptas.","Céntimo","Céntimos",2,2,100],
  ERN:["Eritrean","Nakfa","Nakfa",232,"Nkf","ناكفا","Cent","Cents",2,2,100],
  ETB:["Ethiopian","Birr","Birr",230,"Br","ብር","Santim","Santim",2,2,100],
  EUR:["","Euro","Euros",978,"€","€","Cent","Cents",2,2,100],
  FJD:["Fijian","Dollar","Dollars",242,"FJ$","$","Cent","Cents",2,2,100],
  FKP:["Falkland Islands","Pound","Pounds",238,"FK£","£","Penny","Pence",2,2,100],
  FOK:["Faroese","Króna","Krónas",null,"kr","kr","Oyra","Oyra",2,2,100],
  GBP:["Pound Sterling","Pound","Pounds",826,"£","£","Penny","Pence",2,2,100],
  GEL:["Georgian","Lari","Lari",981,"₾","₾","Tetri","Tetri",2,2,100],
  GGP:["Guernsey","Pound","Pounds",null,"£","£","Penny","Pence",2,2,100],
  GHS:["Ghanaian","Cedi","Cedis",936,"GH₵","₵","Pesewa","Pesewas",2,2,100],
  GIP:["Gibraltar","Pound","Pounds",292,"£","£","Penny","Pence",2,2,100],
  GMD:["Gambian","Dalasi","Dalasis",270,"D","D","Butut","Bututs",2,2,100],
  GNF:["Guinean","Franc","Francs",324,"FG","FG","Centime","Centimes",0,2,100],
  GTQ:["Guatemalan","Quetzal","Quetzales",320,"Q","$","Centavo","Centavos",2,2,100],
  GYD:["Guyanese","Dollar","Dollars",328,"G$","$","Cent","Cents",2,2,100],
  HKD:["Hong Kong","Dollar","Dollars",344,"HK$","$","Cent","Cents",2,2,100],
  HNL:["Honduran","Lempira","Lempiras",340,"L","L","Centavo","Centavos",2,2,100],
  HRK:["Croatian","Kuna","Kuna",191,"kn","kn","Lipa","Lipa",2,2,100],
  HTG:["Haitian","Gourde","Gourdes",332,"G","G","Centime","Centimes",2,2,100],
  HUF:["Hungarian","Forint","Forint",348,"Ft","Ft","fillér","fillér",2,2,100],
  IDR:["Indonesian","Rupiah","Rupiah",360,"Rp","Rp","Sen","Sen",2,2,100],
  // ILS:["Israeli","Shekel","Shekels",376,"₪","₪","Agora","Agoras",2,2,100],
  IMP:["Manx","Pound","Pounds",null,"£","£","Penny","Pence",2,2,100],
  INR:["Indian","Rupee","Rupees",356,"Rs.","₹","Paisa","Paise",2,2,100],
  IQD:["Iraqi","Dinar","Dinars",368,"د.ع.","د.ع.","Fils","Fils",3,3,1000],
  IRR:["Iranian","Rial","Rials",364,"﷼","﷼","Dinar","Dinars",2,2,100],
  ISK:["Icelandic","Krona","Krónur",352,"kr","kr","Aurar","Aurar",0,2,100],
  JEP:["Jersey","Pound","Pounds",null,"£","£","Penny","Pence",2,2,100],
  JMD:["Jamaican","Dollar","Dollars",388,"J$","$","Cent","Cents",2,2,100],
  JOD:["Jordanian","Dinar","Dinars",400,"JD","د.أ.","Fils","Fils",3,3,1000],
  JPY:["Japanese","Yen","Yen",392,"¥","¥","Sen","Sen",0,2,100],
  KES:["Kenyan","Shilling","Shillings",404,"KSh","KSh","Cent","Cents",2,2,100],
  KGS:["Kyrgyzstani","Som","Som",417,"с","с","Tyiyn","Tyiyn",2,2,100],
  KHR:["Cambodian","Riel","Riels",116,"៛","៛","Sen","Sen",2,2,100],
  KID:["Kiribati","Dollar","Dollars",null,"$","$","Cent","Cents",2,2,100],
  KMF:["Comorian","Franc","Francs",174,"CF","CF","Centime","Centimes",0,2,100],
  KPW:["North Korean","Won","Won",408,"₩","₩","Chon","Chon",2,2,100],
  KRW:["South Korean","Won","Won",410,"₩","₩","Jeon","Jeon",0,2,100],
  KWD:["Kuwaiti","Dinar","Dinars",414,"KD","د.ك.","Fils","Fils",3,3,1000],
  KYD:["Cayman Islands","Dollar","Dollars",136,"CI$","$","Cent","Cents",2,2,100],
  KZT:["Kazakhstani","Tenge","Tenge",398,"₸","₸","Tıyn","Tıyn",2,2,100],
  LAK:["Lao","Kip","Kip",418,"₭N","₭","Att","Att",2,2,100],
  LBP:["Lebanese","Pound","Pounds",422,"LL.","ل.ل.","Qirsh","Qirsh",2,2,100],
  LKR:["Sri Lankan","Rupee","Rupees",144,"Rs.","රු or ரூ","Cent","Cents",2,2,100],
  LRD:["Liberian","Dollar","Dollars",430,"L$","$","Cent","Cents",2,2,100],
  LSL:["Lesotho","Loti","maLoti",426,"L","L","Sente","Lisente",2,2,100],
  LYD:["Libyan","Dinar","Dinars",434,"LD","ل.د.","Dirham","Dirhams",3,3,1000],
  MAD:["Moroccan","Dirham","Dirhams",504,"DH","د.م.","Centime","Centimes",2,2,100],
  MDL:["Moldovan","Leu","Lei",498,"L","L","Ban","Bani",2,2,100],
  MGA:["Malagasy","Ariary","Ariary",969,"Ar","Ar","Iraimbilanja","Iraimbilanja",2,0,5],
  MKD:["Macedonian","Denar","Denars",807,"den","ден","Deni","Deni",2,2,100],
  MMK:["Myanmar","Kyat","Kyat",104,"Ks","Ks","Pya","Pya",2,2,100],
  MNT:["Mongolian","Tögrög","Tögrög",496,"₮","₮","möngö","möngö",2,2,100],
  MOP:["Macanese","Pataca","Patacas",446,"MOP$","MOP$","Avo","Avos",2,2,100],
  MRU:["Mauritanian","Ouguiya","Ouguiya",929,"UM","أ.م.","Khoums","Khoums",2,0,5],
  MUR:["Mauritian","Rupee","Rupees",480,"Rs.","रु ","Cent","Cents",2,2,100],
  MVR:["Maldivian","Rufiyaa","Rufiyaa",462,"MRf",".ރ","laari","laari",2,2,100],
  MWK:["Malawian","Kwacha","Kwacha",454,"MK","MK","Tambala","Tambala",2,2,100],
  MXN:["Mexican","Peso","Pesos",484,"MX$","$","Centavo","Centavos",2,2,100],
  MYR:["Malaysian","Ringgit","Ringgit",458,"RM","RM","Sen","Sen",2,2,100],
  MZN:["Mozambican","Metical","Meticais",943,"MTn","MT","Centavo","Centavos",2,2,100],
  NAD:["Namibian","Dollar","Dollars",516,"N$","$","Cent","Cents",2,2,100],
  NGN:["Nigerian","Naira","Naira",566,"₦","₦","Kobo","Kobo",2,2,100],
  NIO:["Nicaraguan","Córdoba Oro","Córdoba Oro",558,"C$","C$","Centavo","Centavos",2,2,100],
  NOK:["Norwegian","Krone","Kroner",578,"kr","kr","øre","øre",2,2,100],
  NPR:["Nepalese","Rupee","Rupees",524,"Rs.","रू","Paisa","Paise",2,2,100],
  NZD:["New Zealand","Dollar","Dollars",554,"NZ$","$","Cent","Cents",2,2,100],
  OMR:["Omani","Rial","Rials",512,"OR","ر.ع.","Baisa","Baisa",3,3,1000],
  PAB:["Panamanian","Balboa","Balboa",590,"B/.","B/.","Centésimo","Centésimos",2,2,100],
  PEN:["Peruvian","Sol","Soles",604,"S/.","S/.","Céntimo","Céntimos",2,2,100],
  PGK:["Papua New Guinean","Kina","Kina",598,"K","K","Toea","Toea",2,2,100],
  PHP:["Philippine","Peso","Pesos",608,"₱","₱","Sentimo","Sentimo",2,2,100],
  PKR:["Pakistani","Rupee","Rupees",586,"Rs.","Rs","Paisa","Paise",2,2,100],
  PLN:["Polish","Zloty","Zlotys",985,"zł","zł","Grosz","Groszy",2,2,100],
  PND:["Pitcairn Islands","Dollar","Dollars",null,"$","$","Cent","Cents",2,2,100],
  PRB:["Transnistrian","Ruble","Rubles",null,"р.","р.","Kopek","Kopeks",2,2,100],
  PYG:["Paraguayan","Guaraní","Guaraníes",600,"₲","₲","Centimo","Centimos",0,2,100],
  QAR:["Qatari","Riyal","Riyals",634,"QR","ر.ق.","Dirham","Dirhams",2,2,100],
  RON:["Romanian","Leu","Lei",946,"L","L","Ban","Bani",2,2,100],
  RSD:["Serbian","Dinar","Dinars",941,"din","дин","Para","Para",2,2,100],
  RUB:["Russian","Ruble","Rubles",643,"₽","₽","Kopek","Kopeks",2,2,100],
  RWF:["Rwandan","Franc","Francs",646,"FRw","R₣","Centime","Centimes",0,2,100],
  SAR:["Saudi","Riyal","Riyals",682,"SR","ر.س.","Halalah","Halalahs",2,2,100],
  SBD:["Solomon Islands","Dollar","Dollars",90,"SI$","$","Cent","Cents",2,2,100],
  SCR:["Seychellois","Rupee","Rupees",690,"Rs.","Rs","Cent","Cents",2,2,100],
  SDG:["Sudanese","Pound","Pounds",938,"£SD","ج.س.","Qirsh","Qirsh",2,2,100],
  SEK:["Swedish","Krona","Kronor",752,"kr","kr","Öre","Öre",2,2,100],
  SGD:["Singapore","Dollar","Dollars",702,"S$","$","Cent","Cents",2,2,100],
  SHP:["Saint Helena","Pound","Pounds",654,"£","£","Penny","Pence",2,2,100],
  SLL:["Sierra Leonean","Leone","Leones",694,"Le","Le","Cent","Cents",2,2,100],
  SLS:["Somaliland","Shilling","Shillings",null,"Sl","Sl","Cent","Cents",2,2,100],
  SOS:["Somali","Shilling","Shillings",706,"Sh.So.","Ssh","Senti","Senti",2,2,100],
  SRD:["Surinamese","Dollar","Dollars",968,"Sr$","$","Cent","Cents",2,2,100],
  SSP:["South Sudanese","Pound","Pounds",728,"SS£","SS£","Qirsh","Qirsh",2,2,100],
  STN:["Sao Tome","Dobra","Dobras",930,"Db","Db","Centimo","Centimos",2,2,100],
  SVC:["Salvadoran","Colón","Colones",222,"₡","₡","Centavo","Centavos",2,2,100],
  SYP:["Syrian","Pound","Pounds",760,"LS","ل.س.","Qirsh","Qirsh",2,2,100],
  SZL:["Swazi","Lilangeni","Emalangeni",748,"L","L","Cent","Cents",2,2,100],
  THB:["Thai","Baht","Baht",764,"฿","฿","Satang","Satang",2,2,100],
  TJS:["Tajikistani","Somoni","Somoni",972,"SM","SM","Diram","Diram",2,2,100],
  TMT:["Turkmenistan","Manat","Manat",934,"m.","T","Tenge","Tenge",2,2,100],
  TND:["Tunisian","Dinar","Dinars",788,"DT","د.ت.","Millime","Millime",3,3,1000],
  TOP:["Tongan","Pa'anga","Pa'anga",776,"T$","PT","Seniti","Seniti",2,2,100],
  TRY:["Turkish","Lira","Lira",949,"TL","₺","Kuruş","Kuruş",2,2,100],
  TTD:["Trinidad and Tobago","Dollar","Dollars",780,"TT$","$","Cent","Cents",2,2,100],
  TVD:["Tuvaluan","Dollar","Dollars",null,"$","$","Cent","Cents",2,2,100],
  TWD:["New Taiwan","Dollar","Dollars",901,"NT$","圓","Cent","Cents",2,2,100],
  TZS:["Tanzanian","Shilling","Shillings",834,"TSh","TSh","Senti","Senti",2,2,100],
  UAH:["Ukrainian","Hryvnia","Hryvnias",980,"₴","грн","Kopiyka","kopiyky",2,2,100],
  UGX:["Ugandan","Shilling","Shillings",800,"USh","Sh","Cent","Cents",0,2,100],
  USD:["US","Dollar","Dollars",840,"$","$","Cent","Cents",2,2,100],
  UYU:["Uruguayan","Peso","Pesos",858,"$U","$","Centésimo","Centésimos",2,2,100],
  UZS:["Uzbekistani","Som","Som",860,"сум","сум","Tiyin","Tiyin",2,2,100],
  VED:["Venezuelan","Bolívar Digital","Bolívars Digital",null,"Bs.","Bs.","Céntimo","Céntimos",2,2,100],
  VES:["Venezuelan","Bolívar","Bolívares",928,"Bs.F","Bs.F","Centimo","Centimos",2,2,100],
  VND:["Vietnamese","Dong","Dong",704,"₫","₫","Hào","Hào",0,2,10],
  VUV:["Vanuatu","Vatu","Vatu",548,"VT","VT","","",0,0,null],
  WST:["Samoan","Tala","Tala",882,"T","ST","Sene","Sene",2,2,100],
  XAF:["Central African CFA","Franc","Francs",950,"Fr","Fr.","Centime","Centimes",0,2,100],
  XCD:["East Caribbean","Dollar","Dollars",951,"$","$","Cent","Cents",2,2,100],
  XOF:["West African CFA","Franc","Francs",952,"₣","₣","Centime","Centimes",0,2,100],
  XPF:["CFP","Franc","Francs",953,"₣","₣","Centime","Centimes",0,0,100],
  YER:["Yemeni","Rial","Rials",886,"YR","ر.ي.","Fils","Fils",2,2,100],
  ZAR:["South African","Rand","Rand",710,"R","R","Cent","Cents",2,2,100],
  ZMW:["Zambian","Kwacha","Kwacha",967,"ZK","ZK","Ngwee","Ngwee",2,2,100],
  ZWB:["RTGS","Dollar","Dollars",null,"","","","",0,0,null],
  ZWL:["Zimbabwean","Dollar","Dollars",932,"Z$","$","Cent","Cents",2,2,100],
  Abkhazia:["Abkhazian","Apsar","Apsark",null,"","","","",0,0,null],
  Artsakh:["Artsakh","Dram","Dram",null,"դր.","դր.","Luma","Luma",2,2,100],
  }

$('#login-btn').click(async () => {
  console.log('Send message');
  const response = await chrome.runtime.sendMessage({
    command: 'fetch-mycoin',
  });
  
  // do something with response here, not outside the function
  console.log(response);
});

$('#checkin-mobile').click(async () => {
  const response = await chrome.runtime.sendMessage({
    command: 'daily-checkin-mobile',
  });
});

$('#checkin-pc').click(async () => {
  await chrome.runtime.sendMessage({
    command: 'daily-checkin',
  });
});

(async () => {
  const options = await chrome.runtime.sendMessage({
    command: 'request-data',
  });
  console.log('Client:', options);

  // Set ui coins parameters
  updateEarnings(options['currency']);

  const lastattempt = options['t-last-checkin-attempt'];
  const retrydelay = options['retry-delay'] * 60 * 1000; // convert to ms
  const future = new Date(lastattempt + retrydelay);

  $('#next-try-time').text(`${future.toLocaleDateString()} ${future.toLocaleTimeString()}`);

  const maxretries = options['max-retries'];
  const retrycount = options['retry-count'];
  const lastcheckin = new Date(options['t-last-checkin-attempt']);
  $('#retries-left').text(maxretries - retrycount);
  $('#prev-try-time').text(`${lastcheckin.toLocaleDateString()} ${lastcheckin.toLocaleTimeString()}`);
  
  $('#max-retries').val(maxretries);
  $('#retry-delay').val(options['retry-delay']);
})();

const updateEarnings = async(target_currency) => {
  const options = await chrome.runtime.sendMessage({
    command: 'request-data',
  });

  // Set currency option according to storage
  $('select[id="currency"] option:selected').attr('selected',null);
  $(`select[id="currency"] option[value="${target_currency}"]`).attr('selected','selected');

  // create our number formatter.
  const formatter = new Intl.NumberFormat(['ar', 'en-US'], {
    style: 'currency',
    currency: target_currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
  });

  const savings_converted = fx.convert(options['user-coins'] / 100.0, {from:'USD', to: target_currency});
  const savings_money = formatter.format(savings_converted);
  const money_converted_pc = fx.convert(options['pc-streak-rate'] / 100.0, {from:'USD', to: target_currency});
  const money_pc = formatter.format(money_converted_pc);
  const money_converted_mobile = fx.convert(options['mobile-streak-rate'] / 100.0, {from:'USD', to: target_currency});
  const money_mobile = formatter.format(money_converted_mobile);

  const total_daily_coins = options['pc-streak-rate'] + options['mobile-streak-rate'];
  const total_converted = fx.convert(total_daily_coins / 100.0, {from:'USD', to: target_currency});
  const total_converted_money = formatter.format(total_converted);

  $('#user-coins').text(options['user-coins']);
  $('#user-savings').text(savings_money);
  $('#pc-streak-rate').text(options['pc-streak-rate']);
  $('#mobile-streak-rate').text(options['mobile-streak-rate']);
  $('#pc-streak-rate-money').text(money_pc);
  $('#mobile-streak-rate-money').text(money_mobile);
  $('#total-streak-rate').text(total_daily_coins);
  $('#total-streak-rate-money').text(total_converted_money);
}

$('#currency').on('change', (e) => {
  (async () => {
    const target_currency = e.target.value;
    console.log(`new currency: ${target_currency}`);
    await chrome.runtime.sendMessage({
      command: 'update-data',
      options: {'currency':target_currency},
    });

    updateEarnings(target_currency);
  })();
});


const APP_ID = 'bb8a8999eefb407989046657a338c9fc';
$(document).ready(async () => {
  const options = await chrome.runtime.sendMessage({
    command: 'request-data',
  });

  fx.base = 'USD';
  // Load exchange rates data via AJAX:
  $.getJSON(
    // NB: using Open Exchange Rates here, but you can use any source!
    `https://openexchangerates.org/api/latest.json?app_id=${APP_ID}&prettyprint=false&show_alternative=false`,
    (data) => {
      // Check money.js has finished loading:
      if ( typeof fx !== "undefined" && fx.rates ) {
        fx.rates = data.rates;
        fx.base = data.base;
      } else {
        // If not, apply to fxSetup global:
        var fxSetup = {
          rates : data.rates,
          base : data.base
        }
      }

      updateEarnings(options['currency']);
    }
  );

  for (const [key, value] of Object.entries(currencyList)) {
    // console.log(`key: ${key}, value: ${value}`);
    $('select#currency').append(`<option value="${key}">${value[0]} ${value[1]}</option>`);
  }
});