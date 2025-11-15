import fs from 'fs'; // for reading files locally
import zlib from 'zlib'; // so we can unzip the gz files
import xml2js from 'xml2js'; // parse xml into js objects

const gzFile = './JMdict_e.gz'; // my JMdict .gz file here
const jsonFile = './JMdict_minimal.json'; // save a local copy just to review

const buffer = fs.readFileSync(gzFile); // reads the binary file hrere
const xml = zlib.gunzipSync(buffer).toString('utf-8'); // unzip and turn into string

// explicit array: false ignores arrays we dont need
// strict false allows invalid xml characters without crashing
const parser = new xml2js.Parser({ explicitArray: false, strict: false});

async function main() 
{
  try {
    const result = await parser.parseStringPromise(xml); // parses xml to js
    const rootKey = Object.keys(result)[0]; // should be JMDICT
    const entries = result[rootKey]?.ENTRY; // should use ENTRY for entries
    if (!entries)
    {
      console.error("List of dictionary entries cannot be found in XML");
      return;
    }
    const minimal = [];
    const entryList = Array.isArray(entries) ? entries : [entries]; // ensures array

    for (const entry of entryList)
    {
      // make sure a list is created, even if no elements
      const kanjiElems = entry.K_ELE ? (Array.isArray(entry.K_ELE) ? entry.K_ELE : [entry.K_ELE]) : [];
      const kanaReadings = entry.R_ELE ? (Array.isArray(entry.R_ELE) ? entry.R_ELE : [entry.R_ELE]) : [];
      const allReadings = kanaReadings.map(r => r.REB).filter(Boolean);
      const words = [];

      // include kanji words
      // basically a version of the word with kanji
      for (const k of kanjiElems)
      {
        const word = k.KEB;
        if (word)
        {
          words.push({ word, reading: allReadings});
        }
      }

      
      // include kana-only words
      // basically a version of the word with kana
      // i use this format to generate a new "word" for each reading
      for (const reading of allReadings)
      {
        words.push({ word: reading, reading: [reading] });
      }

      if (words.length === 0) continue;

      // now we find the definitions in the entry
      const definitions = [];
      // senses is the definition part of the entry
      const senses = entry.SENSE ? (Array.isArray(entry.SENSE) ? entry.SENSE : [entry.SENSE]) : [];
      for (const s of senses)
      {
        // glosses are individual definitions
        const glosses = s.GLOSS ? (Array.isArray(s.GLOSS) ? s.GLOSS : [s.GLOSS]) : [];
        for (const g of glosses)
        {
          const text = g._ || g;
          // so we dont add duplicates
          if (text && !definitions.includes(text)) definitions.push(text);
        }
      }
      if (definitions.length === 0) continue;
      const limitedDefs = definitions.slice(0,3); // only first three definitions

      // now for both the kana and kanji word,
      for (const w of words)
      {
        minimal.push({
        word: w.word,
        reading: w.reading,
        definitions: limitedDefs
        });
      }
    }
    fs.writeFileSync(jsonFile, JSON.stringify(minimal, null, 2));
    console.log(`Saved ${minimal.length} words to ${jsonFile}`);
  }
  catch (err)
  {
    console.error("Error parsing XML", err);
  }
}

main();