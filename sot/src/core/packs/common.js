/* SOT — shared generator utilities for vertical packs.
 *
 * Deterministic: same seed, same world, every reload. Everything produced here
 * is fictional — names, identifiers, dates and clinical detail are generated
 * and correspond to no real person, patient or organization.
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

  const FIRST = ['Amara','Daniel','Priya','Marcus','Elena','Jonah','Keiko','Tobias','Ines','Rafael','Nadia','Curtis','Simone','Aditya','Bridget','Malik','Yuki','Hector','Colette','Devon','Rosa','Nils','Talia','Owen','Farrah','Emeka','Lucia','Grant','Anika','Peter','Sasha','Diego','Meredith','Isaac','Noor','Callum','Beatriz','Hugo','Tessa','Andre','Wren','Kofi','Marina','Silas','Juno','Ravi','Dahlia','Bennett','Solange','Theo','Ingrid','Omar','Cleo','Fintan','Zara','Leland','Mira','Gus','Paloma','Everett','Sunita','Bram','Odile','Kwame','Verity','Aurelio','Nell','Xander','Camila','Reuben','Astrid','Ismael','Greta','Dashiell','Lena','Corbin','Yara','Milo','Freya','Emmett','Rania','Soren','Josefina','Caleb','Delphine','Ruben','Maya','Alistair','Nia','Imani','Bastian','Rosalind','Tarek','Wilhelmina','Jarrah','Selma','Otis','Marisol','Anton'];
  const LAST = ['Okonjo','Reyes','Chandra','Whitfield','Marchetti','Steinberg','Watanabe','Ferreira','Doyle','Alvarado','Haddad','Boone','Lefevre','Nair','Callahan','Osei','Tanaka','Delgado','Beaumont','Pritchard','Iglesias','Bergstrom','Mansour','Kilbride','Amari','Nwosu','Salcedo','Thorne','Rasmussen','Vance','Kovacs','Montoya','Ashford','Feldman','Rahimi','Sinclair','Cardoso','Lindqvist','Brannigan','Sarraf','Halloway','Mensah','Petrova','Wexler','Ibarra','Krishnan','Farrow','Ellsworth','Diallo','Grimaldi','Solberg','Nazari','Fontaine','Kearney','Bashir','Ardoin','Vasquez','Tremblay','Ocampo','Whitlock','Deshpande','Novak','Beauchamp','Adeyemi','Larkin','Costa','Hargrove','Ruiz','Stavros','Lindgren','Baptiste','Mueller','Quintero','Fairbanks','Ozturk','Cavanaugh','Rendon','Blackwood','Sagal','Ivanov','Duplessis','Achebe','Rowan','Villanueva','Strand','Moreau','Kaplan','Underhill','Bhatt','Oyelaran','Ferris','Naumov','Sandoval','Trippe','Ekwueme','Haverford','Lindstrom','Zamora','Bellamy'];

  const STREETS = ['Ashgrove Lane','Kestrel Way','Fenwick Road','Bramble Court','Aldwyn Street','Copperline Drive','Marsh Hollow','Yarrow Close','Ridgeway Terrace','Lantern Row','Halstead Avenue','Wexley Green'];

  function makeNamer(rand) {
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    // Walk shuffled pools with independent cursors rather than sampling at
    // random: random sampling clusters, and a demo where four people in a row
    // share a first name reads as broken data.
    let firsts = shuffle(FIRST), lasts = shuffle(LAST), fi = 0, li = 0;
    const used = new Set();
    return function name() {
      let first, last, key, guard = 0;
      do {
        if (fi >= firsts.length) { firsts = shuffle(FIRST); fi = 0; }
        if (li >= lasts.length) { lasts = shuffle(LAST); li = 0; }
        first = firsts[fi++];
        last = lasts[li++];
        key = first + ' ' + last;
      } while (used.has(key) && guard++ < 400);
      used.add(key);
      return { first, last, full: key };
    };
  }

  function helpers(rand) {
    return {
      rand,
      pick: (arr) => arr[Math.floor(rand() * arr.length)],
      between: (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)),
      chance: (p) => rand() < p,
      shuffle: (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      street: () => STREETS[Math.floor(rand() * STREETS.length)],
    };
  }

  SOT.gen = { mulberry32, makeNamer, helpers, DAY, FIRST, LAST };
})(window.SOT || (window.SOT = {}));
