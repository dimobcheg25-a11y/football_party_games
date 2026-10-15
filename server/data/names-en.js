// Англійські назви для англійської версії сайту: країни/збірні (вручну, за українською назвою)
// і клуби (team-names-en.json — з Wikidata, scripts/build-names-en.js; ручні правки — TEAM_FIX нижче).
const fs = require('fs');
const path = require('path');

const COUNTRIES = {
  'Іспанія': 'Spain', 'Франція': 'France', 'Сполучені Штати Америки': 'USA', 'США': 'USA', 'Аргентина': 'Argentina',
  'Португалія': 'Portugal', 'Сполучене Королівство': 'United Kingdom', 'Велика Британія': 'Great Britain', 'Італія': 'Italy',
  'Саудівська Аравія': 'Saudi Arabia', 'Бразилія': 'Brazil', 'Монако': 'Monaco', 'Нідерланди': 'Netherlands', 'Швеція': 'Sweden',
  'Німеччина': 'Germany', 'Уругвай': 'Uruguay', 'Мексика': 'Mexico', 'Хорватія': 'Croatia', 'Боснія і Герцеговина': 'Bosnia and Herzegovina',
  'Японія': 'Japan', "Об'єднані Арабські Емірати": 'UAE', 'ОАЕ': 'UAE', 'Туреччина': 'Turkey', 'Польща': 'Poland', 'Єгипет': 'Egypt',
  'Швейцарія': 'Switzerland', 'Норвегія': 'Norway', 'Австрія': 'Austria', 'Катар': 'Qatar', 'Мозамбік': 'Mozambique', 'Канада': 'Canada',
  'Угорщина': 'Hungary', 'Ліберія': 'Liberia', "Кот-д'Івуар": 'Ivory Coast', 'Камерун': 'Cameroon', 'Бельгія': 'Belgium',
  'Китайська Народна Республіка': 'China', 'Китай': 'China', 'Сенегал': 'Senegal', 'Росія': 'Russia', 'Колумбія': 'Colombia',
  'Греція': 'Greece', 'Україна': 'Ukraine', 'Південно-Африканська Республіка': 'South Africa', 'ПАР': 'South Africa',
  'Ірландія': 'Ireland', 'Республіка Ірландія': 'Republic of Ireland', 'Австралія': 'Australia', 'Індія': 'India', 'Гонконг': 'Hong Kong',
  'Узбекистан': 'Uzbekistan', 'Ангола': 'Angola', 'Сербія': 'Serbia', 'Алжир': 'Algeria', 'Південна Корея': 'South Korea',
  'Північна Корея': 'North Korea', 'Чехія': 'Czech Republic', 'Марокко': 'Morocco', 'Чилі': 'Chile', 'Вірменія': 'Armenia',
  'Азербайджан': 'Azerbaijan', 'Литва': 'Lithuania', 'Бутан': 'Bhutan', 'Сінгапур': 'Singapore', 'Казахстан': 'Kazakhstan', 'Кіпр': 'Cyprus',
  'Габон': 'Gabon', 'Коста-Рика': 'Costa Rica', 'Парагвай': 'Paraguay', 'Того': 'Togo', 'Болгарія': 'Bulgaria', 'Індонезія': 'Indonesia',
  'Албанія': 'Albania', 'Данія': 'Denmark', 'Румунія': 'Romania', 'Кувейт': 'Kuwait', 'Нігерія': 'Nigeria', 'Грузія': 'Georgia',
  'Союз Радянських Соціалістичних Республік': 'Soviet Union', 'СРСР': 'Soviet Union', 'Еквадор': 'Ecuador', 'Словаччина': 'Slovakia',
  'Гана': 'Ghana', 'Чехословаччина': 'Czechoslovakia', 'Люксембург': 'Luxembourg', 'Словенія': 'Slovenia', 'Сан-Марино': 'San Marino',
  'Фінляндія': 'Finland', 'Джибуті': 'Djibouti', 'Ліхтенштейн': 'Liechtenstein', 'Перу': 'Peru', 'Андорра': 'Andorra', 'Ісландія': 'Iceland',
  'Іран': 'Iran', 'Мальта': 'Malta', 'Білорусь': 'Belarus', 'Венесуела': 'Venezuela', 'Болівія': 'Bolivia', 'Лівія': 'Libya', 'Малі': 'Mali',
  'Союзна Республіка Югославія': 'FR Yugoslavia', 'Югославія': 'Yugoslavia', 'Малайзія': 'Malaysia', 'Чорногорія': 'Montenegro',
  'Тринідад і Тобаго': 'Trinidad and Tobago', 'Північна Македонія': 'North Macedonia', 'Ізраїль': 'Israel', 'Ірак': 'Iraq',
  'Нова Зеландія': 'New Zealand', 'Панама': 'Panama', 'Гвінея': 'Guinea', 'Таїланд': 'Thailand', 'Філіппіни': 'Philippines',
  'Сальвадор': 'El Salvador', 'Естонія': 'Estonia', 'Домініканська Республіка': 'Dominican Republic',
  'Демократична Республіка Конго': 'DR Congo', 'ДР Конго': 'DR Congo', 'Молдова': 'Moldova', 'Таджикистан': 'Tajikistan',
  'Гондурас': 'Honduras', 'Бенін': 'Benin', 'Буркіна-Фасо': 'Burkina Faso', 'Латвія': 'Latvia', 'Косово': 'Kosovo',
  'Центральноафриканська Республіка': 'Central African Republic', 'Німецька Демократична Республіка': 'East Germany', 'НДР': 'East Germany',
  'Кюрасао': 'Curaçao', 'Йорданія': 'Jordan', 'Бахрейн': 'Bahrain', 'Ямайка': 'Jamaica', "Сьєрра-Леоне": 'Sierra Leone',
  'Кабо-Верде': 'Cape Verde', 'Туніс': 'Tunisia', 'Бангладеш': 'Bangladesh', "В'єтнам": 'Vietnam',
  'Турецька Республіка Північного Кіпру': 'Northern Cyprus', 'Нігер': 'Niger', 'Бруней': 'Brunei', 'Гвінея-Бісау': 'Guinea-Bissau',
  'Туркменістан': 'Turkmenistan', 'Мальдіви': 'Maldives', 'Гватемала': 'Guatemala', 'Киргизстан': 'Kyrgyzstan', 'Ліван': 'Lebanon',
  'Оман': 'Oman', 'Камбоджа': 'Cambodia', 'Зімбабве': 'Zimbabwe', 'Лаос': 'Laos', 'Республіка Конго': 'Congo',
  'Фарерські острови': 'Faroe Islands', 'Англія': 'England', 'Шотландія': 'Scotland', 'Уельс': 'Wales',
  'Північна Ірландія': 'Northern Ireland', 'ФРН': 'West Germany', 'Сирія': 'Syria', 'Замбія': 'Zambia', 'Кенія': 'Kenya',
  'Уганда': 'Uganda', 'Мадагаскар': 'Madagascar', 'Судан': 'Sudan', 'Гамбія': 'Gambia', 'Мавританія': 'Mauritania',
  'Екваторіальна Гвінея': 'Equatorial Guinea', 'Танзанія': 'Tanzania', 'Ефіопія': 'Ethiopia', 'Гаїті': 'Haiti', 'Куба': 'Cuba',
  'Нікарагуа': 'Nicaragua', 'Суринам': 'Suriname', 'Гаяна': 'Guyana', 'Бермуди': 'Bermuda', 'Грузинська РСР': 'Georgian SSR',
  'Українська РСР': 'Ukrainian SSR', 'Монголія': 'Mongolia', 'Пакистан': 'Pakistan', 'Афганістан': 'Afghanistan', 'Палестина': 'Palestine',
  'Європа': 'Europe', 'Азія': 'Asia', 'Африка': 'Africa', 'Південна Америка': 'South America', 'Північна Америка': 'North America',
  'Океанія': 'Oceania', 'Тайвань': 'Taiwan', 'Шрі-Ланка': 'Sri Lanka', "М'янма": 'Myanmar', 'Непал': 'Nepal', 'Бурунді': 'Burundi',
  'Руанда': 'Rwanda', 'Малаві': 'Malawi', 'Намібія': 'Namibia', 'Ботсвана': 'Botswana', 'Комори': 'Comoros', 'Еритрея': 'Eritrea',
  'Сомалі': 'Somalia', 'Лесото': 'Lesotho', 'Есватіні': 'Eswatini', 'Чад': 'Chad', 'Барбадос': 'Barbados', 'Гренада': 'Grenada',
  'Пуерто-Рико': 'Puerto Rico', 'Белиз': 'Belize', 'Фіджі': 'Fiji', 'Нова Каледонія': 'New Caledonia', 'Таїті': 'Tahiti',
  'Гібралтар': 'Gibraltar', 'Північний Кіпр': 'Northern Cyprus',
};

let TEAMS = {};
try { TEAMS = JSON.parse(fs.readFileSync(path.join(__dirname, 'team-names-en.json'), 'utf8')); } catch { /* ще не зібрано */ }

// Ручні правки коротких англійських назв, де Wikidata дає довгу або незвичну.
const TEAM_FIX = {
  Q483020: 'PSG', Q631: 'Inter Milan', Q1543: 'AC Milan', Q131499: 'Benfica', Q495299: 'Galatasaray',
  Q6601875: 'Fenerbahçe', Q104761: 'Bayer Leverkusen', Q16844931: 'Inter Miami',
};

const countryEn = (uk) => COUNTRIES[uk] || uk;
// Назва клубу/збірної англійською за qid; збірна — назва країни.
function teamEn(qid, team) {
  if (TEAM_FIX[qid]) return TEAM_FIX[qid];
  if (team?.national) return countryEn(team.name);
  return TEAMS[qid] || team?.name || '';
}

module.exports = { COUNTRIES, countryEn, teamEn };
