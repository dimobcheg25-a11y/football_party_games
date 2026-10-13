// Ручні теги для гравців, які потрапили в базу з Wikidata (не з players.js).
// Ключ — ім'я англійською (як у Wikidata / en.wikipedia), значення — коди категорій.
// Код з мінусом прибирає помилковий тег з Wikidata: 'Pedro Porro': ['-BAR'].
// G300 — тільки ті, у кого 300+ офіційних голів (клуби + збірна) з запасом.

module.exports = {
  'Gerd Müller': ['G300', 'BOOT'],
  'Eusébio': ['G300', 'BOOT'],
  'Karl-Heinz Rummenigge': ['G300'],
  'Hugo Sánchez': ['G300'],
  'Jean-Pierre Papin': ['G300'],
  'Ian Rush': ['G300', 'BOOT'],
  'Jimmy Greaves': ['G300'],
  'Gabriel Batistuta': ['G300'],
  'Klaas-Jan Huntelaar': ['G300'],
  'Romário': ['G300'],
  'Oleh Blokhin': ['G300', 'BALLON'],
  'Giuseppe Meazza': ['G300'],
  'Silvio Piola': ['G300'],
  'Mário Jardel': ['G300', 'BOOT'],
  'Pelé': ['G300'],
  'Igor Belanov': ['BALLON'],

  // ── Тренери, які вигравали турніри лише з лави запасних.
  // Категорії й списки Вікіпедії «чемпіони Європи/світу/Копа» включають і тренерів, а гравцями вони цих трофеїв не мали.
  'Luis Aragonés': ['-EURO'], // Євро-2008 — тренер
  'Vicente del Bosque': ['-WC', '-EURO', '-UCL'], // ЧС-2010, Євро-2012, ЛЧ 2000/2002 — тренер
  'Rinus Michels': ['-EURO'], // Євро-1988 — тренер
  'Luis de la Fuente': ['-EURO', '-WC'], // Євро-2024, ЧС-2026 — тренер
  'Fernando Santos': ['-EURO'], // Євро-2016 — тренер
  'Otto Rehhagel': ['-EURO'],
  'Helmut Schön': ['-WC', '-EURO'],
  'Jupp Derwall': ['-EURO'],
  'Michel Hidalgo': ['-EURO'],
  'Roger Lemerre': ['-EURO'],
  'Roberto Mancini': ['-EURO'], // Євро-2020 — тренер
  'José Villalonga': ['-EURO', '-UCL'],
  'Ferruccio Valcareggi': ['-EURO'],
  'Richard Møller Nielsen': ['-EURO'],
  'Vittorio Pozzo': ['-WC'],
  'Sepp Herberger': ['-WC'],
  'Vicente Feola': ['-WC'],
  'Aymoré Moreira': ['-WC'],
  'Alf Ramsey': ['-WC'],
  'César Luis Menotti': ['-WC'],
  'Enzo Bearzot': ['-WC'],
  'Carlos Bilardo': ['-WC'],
  'Carlos Alberto Parreira': ['-WC', '-COPA'],
  'Aimé Jacquet': ['-WC'],
  'Luiz Felipe Scolari': ['-WC'],
  'Marcello Lippi': ['-WC', '-UCL'],
  'Joachim Löw': ['-WC'],
  'Lionel Scaloni': ['-WC', '-COPA'], // ЧС-2022, Копа 2021/2024 — тренер
  'Mário Zagallo': ['-COPA'], // Копа-1997 — тренер (чемпіон світу як гравець — лишається)
  'Alfio Basile': ['-COPA'],
  'Óscar Tabárez': ['-COPA'],
  'Jorge Sampaoli': ['-COPA'],
  'Juan Antonio Pizzi': ['-COPA'],
  'Tite': ['-COPA'],
  'Vanderlei Luxemburgo': ['-COPA'],
  'Fabio Capello': ['-UCL'],
  'Hansi Flick': ['-UCL'],
  'Luis Enrique': ['-UCL'],
  'Louis van Gaal': ['-UCL'],
  'Jupp Heynckes': ['-UCL'], // ЛЧ 1998/2013 — тренер (Євро-72 і ЧС-74 як гравець — лишаються)

  // ── Помилки Wikidata в клубах
  'Udo Lattek': ['-BAR', '-BAY', '-BVB'], // тренував, а не грав
  'Jason Statham': ['-MUN'], // актор 🙂

  // виправлення Wikidata: числився в клубі, але за першу команду не грав
  'Pedro Porro': ['-BAR', '-MCI'],
};
