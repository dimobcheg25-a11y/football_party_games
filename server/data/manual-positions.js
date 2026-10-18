// Основна позиція, якою гравця знають. Застосовується до transfers.json при завантаженні бази (derived-tags.js).
// 1) Transfermarkt дає поточну позицію — наприкінці кар'єри вона буває не тією (Неймар зараз «атакувальний півзахисник»,
//    а все життя — лівий вінгер; Стерлінг найкращі роки грав зліва).
// 2) Легенд, що завершили до ~2012, у Transfermarkt-датасеті немає — без цього списку в них лише загальне «Півзахисник» з Вікідати
//    (і у «Вгадай гравця» «Півзахисник» ≠ «Центральний півзахисник»). Тут — усі такі гравці рівнів до «Фаната» (poolFor 'fan').
// Коди: GK воротар; CB/LB/RB центральний/лівий/правий захисник; DM опорний, CM центральний, AM атакувальний, LM/RM лівий/правий півзахисник;
// LW/RW лівий/правий вінгер; SS другий нападник; CF центрфорвард.
const CODES = {
  GK: 'Goalkeeper', CB: 'Centre-Back', LB: 'Left-Back', RB: 'Right-Back', DM: 'Defensive Midfield', CM: 'Central Midfield',
  AM: 'Attacking Midfield', LM: 'Left Midfield', RM: 'Right Midfield', LW: 'Left Winger', RW: 'Right Winger', SS: 'Second Striker', CF: 'Centre-Forward',
};

const LIST = {
  // поточна позиція на Transfermarkt — не та, якою гравця знають
  neymar: 'LW', 'raheem-sterling': 'LW',

  // легенди без даних Transfermarkt
  'ronaldo-nazario': 'CF', ronaldinho: 'AM', 'luis-figo': 'RW', 'zinedine-zidane': 'AM', 'george-weah': 'CF', 'andriy-shevchenko': 'CF',
  'roberto-baggio': 'SS', 'diego-maradona': 'AM', 'alessandro-del-piero': 'SS', 'pavel-nedved': 'LM', rivaldo: 'AM', eusebio: 'CF',
  'lilian-thuram': 'RB', 'fabio-cannavaro': 'CB', 'oleg-blokhin': 'LW', 'johan-cruyff': 'CF', 'franz-beckenbauer': 'CB',
  'karl-heinz-rummenigge': 'CF', 'peter-schmeichel': 'GK', 'kakha-kaladze': 'CB', cafu: 'RB', 'thierry-henry': 'CF', 'igor-belanov': 'CF',
  'marcel-desailly': 'CB', 'david-trezeguet': 'CF', 'michael-ballack': 'CM', 'roberto-carlos': 'LB', 'davor-suker': 'CF',
  'jari-litmanen': 'AM', 'raul-gonzalez': 'CF', 'gary-lineker': 'CF', 'hristo-stoichkov': 'LW', 'rui-costa': 'AM', 'paolo-rossi': 'CF',
  'gerd-muller': 'CF', 'marc-overmars': 'LW', 'gabriel-batistuta': 'CF', 'vitor-baia': 'GK', 'bobby-charlton': 'AM',
  'demetrio-albertini': 'CM', 'patrick-vieira': 'DM', 'michel-platini': 'AM', 'diego-forlan': 'CF', dida: 'GK', 'fabien-barthez': 'GK',
  'ruud-gullit': 'AM', aldair: 'CB', 'clarence-seedorf': 'CM', 'michael-laudrup': 'AM', 'diego-simeone': 'DM', 'gilberto-silva': 'DM',
  'nwankwo-kanu': 'CF', 'ivan-cordoba': 'CB', adriano: 'CF', 'santiago-canizares': 'GK', 'frank-de-boer': 'CB', 'denis-law': 'CF',
  'youri-djorkaeff': 'AM', emerson: 'DM', 'eric-cantona': 'SS', 'jurgen-klinsmann': 'CF', 'alessandro-nesta': 'CB',
  'steve-mcmanaman': 'RM', 'hidetoshi-nakata': 'AM', 'andy-cole': 'CF', 'emmanuel-petit': 'DM', 'denis-irwin': 'LB', 'kevin-keegan': 'SS',
  'hasan-salihamidzic': 'RM', 'owen-hargreaves': 'DM', 'andoni-zubizarreta': 'GK', 'gennaro-gattuso': 'DM', 'gianluca-zambrotta': 'RB',
  'fernando-hierro': 'CB', 'didier-deschamps': 'DM', 'edgar-davids': 'CM', 'filippo-inzaghi': 'CF', 'mikael-silvestre': 'CB',
  'frank-rijkaard': 'DM', 'serhiy-rebrov': 'SS', 'luis-fabiano': 'CF', 'fred-q312772': 'CF', geremi: 'RM', 'paul-breitner': 'CM',
  'sylvain-wiltord': 'RW', 'roy-keane': 'CM', 'jerzy-dudek': 'GK', 'marek-jankulovski': 'LB', 'dennis-bergkamp': 'SS',
  'jurgen-kohler': 'CB', 'thomas-helmer': 'CB', 'claude-makelele': 'DM', 'predrag-mijatovic': 'SS', 'maxi-rodriguez': 'RM',
  'oliver-bierhoff': 'CF', 'patrick-kluivert': 'CF', 'zvonimir-boban': 'AM', 'ze-roberto': 'LM', 'pep-guardiola': 'DM',
  'daniele-massaro': 'CF', 'sami-hyypia': 'CB', 'jean-pierre-papin': 'CF', 'vincent-candela': 'LB', 'hernan-crespo': 'CF',
  'christian-panucci': 'RB', 'giuseppe-favalli': 'LB', elano: 'RM', 'oleh-protasov': 'CF', 'dario-simic': 'RB',
  'angelos-charisteas': 'CF', 'ole-gunnar-solskj-r': 'CF', 'ronald-koeman': 'CB', 'ivan-zamorano': 'CF', 'fernando-couto': 'CB',
  'emile-heskey': 'CF', 'brian-laudrup': 'LW', 'nuno-gomes': 'CF', 'juan-sebastian-veron': 'CM', 'matthias-sammer': 'CB',
  'alessandro-altobelli': 'CF', 'teddy-sheringham': 'SS', 'dwight-yorke': 'CF', 'christian-vieri': 'CF', 'fernando-redondo': 'DM',
  'marcelo-martins-moreno': 'CF', 'hakan-sukur': 'CF', 'andriy-rusol': 'CB', 'aron-winter': 'CM', 'christian-karembeu': 'DM',
  'claudio-caniggia': 'SS', 'vladyslav-vashchuk': 'CB', 'stefan-reuter': 'RB', 'steve-finnan': 'RB', 'robbie-keane': 'SS',

  'giovanni-van-bronckhorst': 'LB', 'dino-zoff': 'GK', 'karel-poborsky': 'RM', 'laurent-blanc': 'CB', 'andreas-moller': 'AM',
  'leonardo-araujo': 'AM', 'alan-shearer': 'CF', 'robert-pires': 'LM', 'luis-enrique': 'CM', 'samuel-kuffour': 'CB',
  'gaizka-mendieta': 'CM', 'alen-boksic': 'CF', edmilson: 'CB', 'serhiy-skachenko': 'CF', careca: 'CF', 'julio-salinas': 'CF',
  'dietmar-hamann': 'DM', 'paulo-futre': 'LW', 'salvatore-schillaci': 'CF', 'john-carew': 'CF', 'angelo-peruzzi': 'GK', 'nicky-butt': 'CM',
  'tomasz-kuszczak': 'GK', 'luis-garcia': 'RW', 'rustu-recber': 'GK', edmundo: 'CF', 'jan-koller': 'CF', 'fulvio-collovati': 'CB',
  'marcio-amoroso': 'CF', 'franco-causio': 'RW', 'andreas-brehme': 'LB', rai: 'AM', 'oleh-luzhnyi': 'RB', 'ruud-van-nistelrooy': 'CF',
  'fernando-morientes': 'CF', jadson: 'AM', 'alfredo-di-stefano': 'CF', 'roberto-donadoni': 'RM', 'juan-roman-riquelme': 'AM',
  'christian-ziege': 'LB', 'ansi-agolli': 'LB', edilson: 'CF', 'mauro-camoranesi': 'RM', 'sol-campbell': 'CB', 'mario-kempes': 'CF',
  'marcos-paulo': 'CM', 'enzo-francescoli': 'AM', 'david-seaman': 'GK', 'txiki-begiristain': 'LW', 'carlo-ancelotti': 'CM',
  'miguel-monteiro': 'RB', 'anatoliy-demyanenko': 'LB', 'patrik-andersson': 'CB', 'ronald-de-boer': 'CM', luizao: 'CF',
  'jens-lehmann': 'GK', 'henrik-larsson': 'CF', 'roberto-ayala': 'CB', 'michel-salgado': 'RB', 'jaap-stam': 'CB',
  'christophe-dugarry': 'CF', 'jay-jay-okocha': 'AM', 'badr-el-kaddouri': 'LB', 'mark-hughes': 'CF', 'rudi-voller': 'CF', doni: 'GK',
  dunga: 'DM', 'nicolas-lodeiro': 'AM', 'thomas-ha-ler': 'CM', djalminha: 'AM', 'frederic-kanoute': 'CF', 'jon-dahl-tomasson': 'CF',
  'marcos-senna': 'DM', 'goran-gavrancic': 'CB', 'uwe-bein': 'AM', garrincha: 'RW', 'andrei-kanchelskis': 'RW', 'ian-rush': 'CF',
  'sani-kaita': 'DM', bebeto: 'CF', 'michael-reiziger': 'RB', 'basile-boli': 'CB', 'massimo-oddo': 'RB', 'david-ginola': 'LW',
  'jose-altafini': 'CF', 'claudio-lopez': 'LW', 'willy-sagnol': 'RB', 'zlatko-zahovic': 'AM', 'ian-wright': 'CF', 'fredi-bobic': 'CF',
  'ivan-helguera': 'CB', 'ariel-ortega': 'AM', beto: 'CM', 'gianfranco-zola': 'SS', 'claudio-taffarel': 'GK', 'allan-simonsen': 'SS',
  'patrick-mboma': 'CF', 'freddie-ljungberg': 'LM', maniche: 'CM', 'bernd-schuster': 'CM', 'oleg-salenko': 'CF', jorginho: 'RB',
  'gianluca-vialli': 'CF', 'gerald-vanenburg': 'RW', 'markus-babbel': 'CB', 'marcelo-salas': 'CF', 'andriy-husin': 'CM',
  'zdenek-grygera': 'RB', 'benni-mccarthy': 'CF', 'gheorghe-hagi': 'AM', 'raymond-kopa': 'AM', 'valyantsin-byalkevich': 'AM',
  juan: 'CB', 'david-james': 'GK', 'robert-enke': 'GK', 'mateja-kezman': 'CF',
};

module.exports = Object.fromEntries(Object.entries(LIST).map(([id, code]) => [id, CODES[code]]));
