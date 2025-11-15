import fs from 'fs'; // for reading files locally
import zlib from 'zlib'; // so we can unzip the gz files
import xml2js from 'xml2js'; // parse xml into js objects
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: "us-west-2" }); 
const tableName = "DictionaryEntries";

// creates a dynamo db item for upload batch
function createDynamoItem(wordObj)
{
  return {
    PutRequest: {
      Item: 
      {
        Word: { S: wordObj.word },
        Readings: { SS: wordObj.readings },
        Definitions: { SS: wordObj.definitions }
      }
    }
  };
}

async function uploadBatch(batchItems) 
{

  const command = new BatchWriteItemCommand({
    RequestItems: {
    [tableName]: batchItems
    }
  });

  try {
    return await client.send(command); // sends the batch to dynamobd here
  }
  catch (err) {
    console.error("Error uploading batch to DynamoDB, retrying..", err);
    await new Promise(r => setTimeout(r,500)); //waits half a second
    return await client.send(command); // sends the batch to dynamobd here
  }
}

// function to split array into chunks of max size 25
function chunkArray(array, size)
{
  const chunks = [];
  for (let i = 0; i<array.length; i+=size)
  {
    chunks.push(array.slice(i, i+size));
  }
  return chunks;
}

const gzFile = './JMdict_e.gz'; // my JMdict .gz file here
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

    const wordMap = new Map();
    const entryList = Array.isArray(entries) ? entries : [entries]; // ensures array

    for (let i=0; i<entryList.length;i++)
    {
      const entry = entryList[i];
      if (i % 1000 === 0) console.log(`Processed ${i} entries...`);


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

      

      // make sure a list is created, even if no elements
      const kanjiElems = entry.K_ELE ? (Array.isArray(entry.K_ELE) ? entry.K_ELE : [entry.K_ELE]) : [];
      const kanaReadings = entry.R_ELE ? (Array.isArray(entry.R_ELE) ? entry.R_ELE : [entry.R_ELE]) : [];
      const allReadings = kanaReadings.map(r => r.REB).filter(Boolean);

      // include kanji words
      // basically a version of the word with kanji
      for (const k of kanjiElems)
      {
        const word = k.KEB;
        if (!word) continue;

        if (wordMap.has(word))
        {
          const existing = wordMap.get(word);
          existing.definitions = Array.from(new Set([...existing.definitions, ...limitedDefs]));
          existing.readings = Array.from(new Set([...existing.readings, ...allReadings]));
        }
        else {
          wordMap.set(word, { readings: allReadings, definitions: limitedDefs });
        }
      }

      
      // include kana-only words
      // basically a version of the word with kana
      // i use this format to generate a new "word" for each reading
      for (const reading of allReadings)
      {
        if (wordMap.has(reading)) 
        {
          const existing = wordMap.get(reading);
          existing.definitions = Array.from(new Set([...existing.definitions, ...limitedDefs]));
          existing.readings = Array.from(new Set([...existing.readings, reading]));
        }
        else 
        {
          wordMap.set(reading, { readings: [reading], definitions: limitedDefs });
        }
      }

    }

    // adds the definition to the words and turns them into dynamodb items
    const allItems = Array.from(wordMap.entries()).map(([word, data]) => createDynamoItem({
      word,
      readings: data.readings,
      definitions: data.definitions,
    }));


    const batches = chunkArray(allItems, 25);
    const parallelLimit = 10;
    for (let i=0;i<batches.length; i += parallelLimit)
    {
      const batchSlice = batches.slice(i, i + parallelLimit);
      // send multiple simultaneously
      await Promise.all(batchSlice.map(batch => uploadBatch(batch)));
      console.log(`Uploaded batches ${i + 1} to ${i + batchSlice.length}`);
    }

    console.log('Finished uploading all dictionary entries!');

  }
  catch (err)
  {
    console.error("Error parsing XML or uploading", err);
  }
}

main();