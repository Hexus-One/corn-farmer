// by Corns McGowan
// This bot tries to make a wheat farm and expand it nonstop

const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { pathfinder, Movements, goals: { GoalBlock, GoalNear, GoalNearXZ, GoalPlaceBlock, GoalLookAtBlock } } = require('mineflayer-pathfinder');

const vec3 = require('vec3');
const { sleep } = require('mineflayer/lib/promise_utils');

const RANGE_GOAL = 1; // get within this radius of the player

const bot = mineflayer.createBot({
  host: process.argv[2],
  port: parseInt(process.argv[3]),
  auth: process.argv[4],
  username: process.argv[5],
  password: process.argv[6]
});

bot.loadPlugin(require('mineflayer-collectblock').plugin);
bot.loadPlugin(pathfinder);

bot.on('kicked', (reason, loggedIn) => console.log(reason, loggedIn));
bot.on('end', (reason) => console.log(reason));
bot.on('error', err => console.log(err));

const CARDINAL = [
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0]
]

// when checking neighbours, more likely to have flat terrain
// tiny optimisation hehe
const Y_OFFSET = [0, 1, -1];

// please forgive this mess of fields
let defaultMove;
let delicateMove;
let mcData; // gets loaded after bot joins server (version unknown)
let currentGoal = null;
let fakeTable = { id: 'minecraft:crafting_table' }
let tableID;
let tableRecipes;
let plankIDs = [];
let logItemIDs = [];
let logBlockIDs = [];
let farm = [];
let toTill = [];

bot.once('spawn', async () => {
  console.log("Joined server!");
  mcData = require('minecraft-data')(bot.version);
  mineflayerViewer(bot, { port: 3007, firstPerson: false }); // port is the minecraft server port, if first person is false, you get a bird's-eye view
  defaultMove = new Movements(bot); // contains settings/config about the pathfinder
  delicateMove = new Movements(bot);
  delicateMove.canDig = false;
  delicateMove.placeCost = 9999;
  delicateMove.maxDropDown = 1;
  delicateMove.allowParkour = false;

  // generate tables
  tableID = mcData.itemsByName["crafting_table"].id;
  tableRecipes = bot.recipesAll(tableID, null, null);
  plankIDs = tableRecipes.reduce((plankArray, recipe) => {
    plankArray.push(recipe.delta[0].id);
    return plankArray;
  }, []);
  plankIDs.forEach(plank => {
    // get a list of all logs used to craft the planks while we're here
    bot.recipesAll(plank, null, null).forEach(logRecipe => {
      logItemIDs.push(logRecipe.delta[0].id);
      // convert itemID to blockID
      logBlockIDs.push(
        mcData.blocksByName[mcData.items[logRecipe.delta[0].id].name].id);
    });
  });
  await bot.waitForChunksToLoad();
  // await mainLoop();
});

bot.on('chat', async (username, message) => {
  console.log("chat", username, message);
  if (username === bot.username) return; // i.e. ignore own messages
  const ARGS = message.split(' ');
  let count; // used in two cases below
  //*
  switch (ARGS[0]) {
    case "cmere":
      const target = bot.players[username]?.entity;
      if (!target) {
        console.log("Target not found :c");
        return;
      }
      const { x: playerX, y: playerY, z: playerZ } = target.position;
      bot.pathfinder.setMovements(delicateMove);
      await bot.pathfinder.goto(
        new GoalNear(playerX, playerY, playerZ, RANGE_GOAL))
        .catch(console.log);
      break
    case "log":
      await getLog();
      break;
    case "collect":
      count = 1;
      if (ARGS.length === 3) count = parseInt(ARGS[1]);
      let type = ARGS[1];
      if (ARGS.length === 3) type = ARGS[2];
      await testCollect(type, count);
      break;
    case 'harvest':
      count = 1;
      if (ARGS.length === 2) count = parseInt(ARGS[1]);
      await harvest(count);
      break;
    case 'detect':
      farm = detectFarm();
      break;
    case 'decay':
      toTill = checkDecay(farm);
      break;
    case 'fix':
      await hoeAndSow(toTill);
      break;
    case 'expand':
      await hoeAndSow(getFlatNeighbours(farm, 400));
      break;
    case 'mainloop':
      await mainLoop();
      break;
    case 'bed':
      await sleepInBed();
      break;
    case 'chomp':
      await chomp();
      break;
  }
  //*/
})

bot.on('whisper', async (username, message) => {
  console.log("whisper", username, message);
});

bot.on('entityHurt', async (entity) => {
  if (entity === bot.entity && bot.health < 15) {
    bot.quit();
  }
});

/*
bot.on('itemDrop', async (entity) => {
    if (mcData == null || entity.name !== "item") return;
    console.log("itemdrop", mcData.items[entity.metadata["8"].itemId].name);
});
//*/

// I thought it would be neat for the bot to retill on the fly
// but this method makes it backtrace way too often
/*
bot.on('blockUpdate', async (oldBlock, newBlock) => {
  // console.log('blockUpdate', oldBlock, newBlock)
  // replace trampled/decayed farmland if we encounter any
  if (oldBlock.name === "farmland" && newBlock.name === "dirt") {
    let dirt = newBlock.position;
    toTill.push(dirt);
  }
})
//*/

async function mainLoop() {
  while (true) {
    /* if (bot.time.timeOfDay > 12500 || bot.thunderState > 0.5) {
      await sleepInBed();
    }
    await chomp(); */
    farm = detectFarm(farm);
    let decay = checkDecay(farm);
    let neighbours = getFlatNeighbours(farm, 2000, false);
    console.log(neighbours.length, "flat neighbours found");
    // if there no neighbours, that means we've expanded to all flat areas
    // search for areas above and below
    if (neighbours.length == 0) {
      neighbours = getSlopeNeighbours(farm, 1);
    }
    toTill = [...decay, ...neighbours];
    bot.viewer.drawPoints('todo', toTill.map(elem => elem.offset(0.5, 2, 0.5),
      0xff0000, 5)); // these extra args don't work :c
    await hoeAndSow(toTill, 500);
    bot.viewer.erase('todo');
    // no crops available to harvest, wait a little
    if (bot.game.gameMode === 'survival' && await harvest() == 0) {
      await bot.waitForTicks(200);
    } else {
      await bot.waitForTicks(20);
    }
  }
}

// make bread and eat it (assuming we have wheat)
async function chomp() {
  // check bread count
  // if we have < a threshold, craft bread up to 64
  const breadID = mcData.itemsByName['bread'].id;
  const wheatID = mcData.itemsByName['wheat'].id;
  let breadCount = countInventory('bread');
  if (breadCount < 10) {
    let breadRecipes = bot.recipesFor(breadID, null, 1, fakeTable);
    if (breadRecipes.length == 0) {
      console.log("Not enough wheat to make bread!");
      return;
    }
    await getCraftingTable();
    // we only want 64 bread max
    let canMake = Math.floor(countInventory('wheat') / 3);
    canMake = Math.min(canMake, 64 - breadCount);
    await craftWithTable(breadRecipes[0], canMake)
      .catch(console.log);
  }
  // eat the bread (if we actually have any)
  while (countInventory('bread') > 0 && bot.food < 20) {
    await bot.equip(breadID);
    bot.activateItem();
    //await bot.consume().catch(console.log);
    await bot.waitForTicks(20);
  }
  bot.deactivateItem();
  // throw away any excess wheat
  await bot.look(bot.entity.yaw, 0, true);
  await bot.toss(wheatID, null, Math.max(countInventory("wheat") - 192, 0));
}

// assume the bot has a bed
// find a valid place for the bed
// sleep in the bed
// once the bot's awake, break the bed and pick it up
async function sleepInBed() {
  let bed = bot.findBlock({
    matching: block => bot.isABed(block),
    maxDistance: 160
  });
  bot.pathfinder.setMovements(delicateMove);
  await bot.pathfinder.goto(
    new GoalNear(bed.position.x,
      bed.position.y,
      bed.position.z,
      RANGE_GOAL))
    .catch(console.log);
  while (bot.time.timeOfDay > 12000) {
    try {
      await bot.sleep(bed)
      break;
    } catch (error) {

    }
    await bot.waitForTicks(20);
  }
}

// till and plant the given blocks
async function hoeAndSow(tiles, max = null) {
  const seedID = mcData.itemsByName['wheat_seeds'].id;
  const farmlandID = mcData.blocksByName['farmland'].id;
  const grassIDs = [ // maybe add flowers too
    mcData.blocksByName['grass'].id,
    mcData.blocksByName['tall_grass'].id
  ];
  let tillCount = 0;
  while (tiles.length > 0) {
    if (bot.time.timeOfDay > 12500 || bot.thunderState > 0.5) {
      await sleepInBed();
    }
    await chomp();
    if (max != null && tillCount > max) break;
    if (countInventory('wheat_seeds') < 32) {
      console.log("Fetching more seeds...");
      await harvest(64);
      if (countInventory('wheat_seeds') < 32) { // i.e. we obtained 0 seeds
        console.log("Not enough seeds to continue! Aborting...");
        return; // too scared to use actual throw/try/catch
      }
    }
    // find the closest tile while retaining the index
    // so we can remove it later
    // reduce is O(n) time and we perform it n times
    // sort would be O(nlogn) but our "closest" position changes frequently
    // so we'd have to redo it every time for O(n2logn) which is worse
    let indexToRemove;
    let position = tiles.reduce((best, item, index) => {
      if (!best) {
        indexToRemove = index;
        return item;
      }
      if (item.distanceTo(bot.entity.position)
        < best.distanceTo(bot.entity.position)) {
        indexToRemove = index;
        return item;
      } else {
        return best;
      }
    }, null);
    await equipHoe();
    bot.pathfinder.setMovements(delicateMove);
    await bot.pathfinder.goto(
      new GoalNear(position.x, position.y + 1, position.z, RANGE_GOAL))
      .catch(console.log);
    // destroy any grass that might be on top
    let above = bot.blockAt(position.offset(0, 1, 0));
    if (above === null) {
      tiles[indexToRemove] = tiles[tiles.length - 1];
      let tile = tiles.pop();
      if (!hasPosition(farm, tile)) farm.push(tile);
      continue;
    }
    if (grassIDs.includes(above.type)) {
      await bot.unequip('hand');
      await bot.dig(above, true).catch(console.log);
      await bot.waitForTicks(1);
      await equipHoe();
      bot.pathfinder.setMovements(delicateMove);
    }
    // a bit faster than waiting for activateBlock
    await bot.lookAt(position.offset(0, 0.5, 0), true);
    // till if its not farmland
    let dirt = bot.blockAt(position);
    if (dirt.type != farmlandID) {
      await bot.activateBlock(dirt);
    }
    await bot.equip(seedID);
    await bot.activateBlock(dirt).catch(console.log);
    tiles[indexToRemove] = tiles[tiles.length - 1];
    let tile = tiles.pop();
    if (!hasPosition(farm, tile)) farm.push(tile); // add it back to the farm
    tillCount++;
  }
}

// get all contiguous farmland blocks
function detectFarm(farm) {
  const farmlandID = mcData.blocksByName['farmland'].id;
  if (farm === null || farm.length == 0) {
    farm = bot.findBlocks({
      matching: farmlandID,
      maxDistance: 64,
      count: 20 // 33*33 square has area 1089 so this should cover every farmland
      // unless we're sitting in a stacked tower somehow
    });
  }
  // loop through farmland blocks and check their neighbours
  // if its more farmland, add it to the farmland list
  // small optimisation: we check flat neighbours first,
  // also if we succeed on one direction then we skip to the next direction
  // foreach doesn't work on new elements in array so we're using for
  for (let i = 0; i < farm.length; i++) {
    const position = farm[i];
    CARDINAL.forEach(direction => {
      for (let j = 0; j < Y_OFFSET.length; j++) {
        const y = Y_OFFSET[j];
        let newPos = position.offset(direction[0], y, direction[2]);
        let farmBlock = bot.blockAt(newPos)
        if (farmBlock === null || farmBlock.type != farmlandID) continue;
        if (hasPosition(farm, newPos)) continue;
        farm.push(newPos);
        break;
      }
    });
  }
  console.log("Detected", farm.length, "tiles!");
  return farm;
}

// check neighbours of existing farmland tiles for candidates
// returns tiles suitable for farming
// max is max tiles to search before stopping (can return slightly larger)
// adjacent only - only check immediate neighbours
function getFlatNeighbours(farmland, max, adjacentOnly = false) {
  const tillableIDs = [
    mcData.blocksByName['dirt'].id,
    mcData.blocksByName['grass_block'].id,
    // mcData.blocksByName['farmland'].id
  ];
  const airIDs = [
    mcData.blocksByName['air'].id,
    mcData.blocksByName['cave_air'].id,
  ];
  const grassIDs = [ // maybe add flowers too
    mcData.blocksByName['grass'].id,
    mcData.blocksByName['tall_grass'].id,
    // mcData.blocksByName['wheat'].id
  ];
  let oldSize = farmland.length;
  let candidates = [];
  // one loop to check neighbours of farm tiles
  for (let i = 0; i < farmland.length; i++) {
    if (candidates.length > max) return candidates;
    const position = farmland[i];
    CARDINAL.forEach(direction => {
      let newPos = position.offset(...direction);
      let newPosBlock = bot.blockAt(newPos);
      let blockAbove = bot.blockAt(newPos.offset(0, 1, 0));
      // tl;dr needs to be dirt with air/grass above, and not already in list
      if (newPosBlock === null) return;
      if ((tillableIDs.includes(newPosBlock.type))
        && (airIDs.includes(blockAbove.type)
          || grassIDs.includes(blockAbove.type))
        && (!hasPosition(farmland, newPos))
        && (!hasPosition(candidates, newPos))) {
        candidates.push(newPos);
      }
    });
  }
  if (adjacentOnly) return candidates;
  // another loop to check neighbours of neighbours (maybe)
  for (let i = 0; i < candidates.length; i++) {
    if (candidates.length > max) return candidates;
    const position = candidates[i];
    CARDINAL.forEach(direction => {
      let newPos = position.offset(...direction);
      let newPosBlock = bot.blockAt(newPos);
      let blockAbove = bot.blockAt(newPos.offset(0, 1, 0));
      // tl;dr needs to be dirt with air/grass above, and not already in list
      if (newPosBlock === null) return;
      if ((tillableIDs.includes(newPosBlock.type))
        && (airIDs.includes(blockAbove.type)
          || grassIDs.includes(blockAbove.type))
        && (!hasPosition(farmland, newPos))
        && (!hasPosition(candidates, newPos))) {
        candidates.push(newPos);
      }
    });
  }
  return candidates;
}

// find candidates for going up or down terrain
function getSlopeNeighbours(farmland, max) {
  const slopeCandidates = [
    [ // North
      [-1, 0, -2], [0, 0, -2], [1, 0, -2],
      [-1, 0, -1], [0, 0, -1], [1, 0, -1]
    ],
    [ // South
      [-1, 0, 2], [0, 0, 2], [1, 0, 2],
      [-1, 0, 1], [0, 0, 1], [1, 0, 1]
    ],
    [ // East
      [2, 0, -1], [2, 0, 0], [2, 0, 1],
      [1, 0, -1], [1, 0, 0], [1, 0, 1]
    ],
    [ // West
      [-2, 0, -1], [-2, 0, 0], [-2, 0, 1],
      [-1, 0, -1], [-1, 0, 0], [-1, 0, 1]
    ],
  ];
  const heightOffsets = [
    [0, 1, 0],
    [0, -1, 0]
  ];
  const farmlandID = mcData.blocksByName['farmland'].id;
  const tillableIDs = [
    mcData.blocksByName['dirt'].id,
    mcData.blocksByName['grass_block'].id,
    // mcData.blocksByName['farmland'].id
  ];
  const airIDs = [
    mcData.blocksByName['air'].id,
    mcData.blocksByName['cave_air'].id,
  ];
  const grassIDs = [ // maybe add flowers too
    mcData.blocksByName['grass'].id,
    mcData.blocksByName['tall_grass'].id,
    // mcData.blocksByName['wheat'].id
  ];
  let candidates = [];
  // one loop to check neighbours of farm tiles
  for (let i = 0; i < farmland.length; i++) {
    if (candidates.length > max) return candidates;
    slopeCandidates.forEach(direction => {
      // iterate through all 6 tiles
      // if every tile is valid, then we add the 6 tiles
      // to the candidate list
      heightOffsets.some(heightOffset => {
        const position = farmland[i].offset(...heightOffset);
        if (direction.every(subTile => {
          let subTilePos = position.offset(...subTile);
          let subTileBlock = bot.blockAt(subTilePos);
          if (subTileBlock === null) return false;
          let blockAbove = bot.blockAt(subTilePos.offset(0, 1, 0));
          return (tillableIDs.includes(subTileBlock.type)
            && (airIDs.includes(blockAbove.type)
              || grassIDs.includes(blockAbove.type)));
        })) {
          direction.forEach(subtile => {
            let subTilePos = position.offset(...subtile);
            if (!hasPosition(farmland, subTilePos)
              && !hasPosition(candidates, subTilePos)) {
              candidates.push(subTilePos);
            }
          })
          return true;
        }
      });
    });
  }
  return candidates;
}

// check all farmland blocks and see if any have changed
// eg trampled (reverted to dirt/grass and has air above)
// otherwise remove it from the farmland list (eg removed or block on top)
// return trampled blocks (salvageable)
// also includes farmland without wheat (it will likely decay later)
function checkDecay(farmland) {
  const farmlandID = mcData.blocksByName['farmland'].id;
  const tillableIDs = [
    mcData.blocksByName['dirt'].id,
    mcData.blocksByName['grass_block'].id
  ];
  const airIDs = [
    mcData.blocksByName['air'].id,
    mcData.blocksByName['cave_air'].id,
  ];
  let trampled = [];
  let i = 0;
  while (i < farmland.length) {
    let tile = bot.blockAt(farmland[i]);
    if (tile === null) {
      i++;
    } else if (tile.type == farmlandID) {
      if (airIDs.includes(bot.blockAt(farmland[i].offset(0, 1, 0)).type)) {
        trampled.push(farmland[i]);
      }
      i++;
    } else if (tillableIDs.includes(tile.type)
      && airIDs.includes(bot.blockAt(farmland[i].offset(0, 1, 0)).type)) {
      // tillable with air above; salvageable
      trampled.push(farmland[i]);
      i++;
    } else { // can't save it, remove from farmland list
      // also don't increment i because of
      // the way we remove the item from the list
      farmland[i] = farmland[farmland.length - 1];
      farmland.pop();
    }
  }
  console.log("Found", trampled.length, "trampled tiles");
  return trampled;
}

// attempt to harvest (and replant) this many wheat blocks
// cancel if we can't find wheat
// or don't have any seeds to start (for instant replant)
// TODO: maybe change this to only harvest known farmland?
async function harvest(count = 1) {
  bot.pathfinder.setMovements(delicateMove);
  // even though we usually get more seeds than we sow,
  // its nice to have seeds to start with so we can instant replant
  // in case the farmland is dry - don't want to risk it decaying in one tick
  if (countInventory('wheat_seeds') < 2) {
    console.log("Out of seeds!");
    return 0;
  }
  let harvested = 0;
  for (let i = 0; i < count; i++) {
    const wheatID = mcData.blocksByName['wheat'].id;
    const seedID = mcData.itemsByName['wheat_seeds'].id;
    let target = bot.findBlocks({
      matching: (block) => {
        return block.type === wheatID && block.metadata === 7;
      },
      maxDistance: 64
    });
    if (target.length == 0) {
      console.log("Ran out of wheat to harvest!");
      break;
    };
    await bot.equip(seedID);
    await bot.pathfinder.goto(
      new GoalBlock(target[0].x, target[0].y, target[0].z)).catch(console.log);
    let wheat = bot.blockAt(target[0]);
    // small chance we trampled the block we're about to harvest
    if (wheat.type != wheatID) continue;
    await bot.dig(wheat, true);
    await bot.activateBlock(bot.blockAt(target[0].offset(0, -1, 0)));
    await bot.waitForTicks(10);
    // await waitForPickup(seedID); // gets stuck if we're in creative
    harvested++;
  }
  return harvested;
}

// returns number of matching items/blocks
function countInventory(itemName) {
  let items = bot.inventory.items();
  itemResult = items.filter(item => item.name === itemName);
  return itemResult.reduce((subtotal, item) => subtotal + item.count, 0);
};

async function equipHoe() {
  if (countInventory("wooden_hoe") < 1) await craftHoe();
  if (!bot.heldItem || bot.heldItem.name != "wooden_hoe") {
    await bot.equip(mcData.itemsByName["wooden_hoe"].id);
  }
};

// attempt to craft a hoe
// assumes vanilla crafting recipes as of Java 1.19.3
async function craftHoe(count = 1) {
  const hoeID = mcData.itemsByName["wooden_hoe"].id;
  // check we have sticks, planks and a table (and acquire them if we don't)
  await getCraftingTable();
  await getSticks(2);
  await getPlanks(2);
  let hoeRecipes = bot.recipesFor(hoeID, null, 1, fakeTable);
  console.log(hoeRecipes);
  await craftWithTable(hoeRecipes[0]);
};

async function craftAxe(count = 1) {
  const axeID = mcData.itemsByName["wooden_axe"].id;
  // check we have sticks, planks and a table (and acquire them if we don't)
  await getCraftingTable();
  await getSticks(2);
  await getPlanks(3);
  let axeRecipes = bot.recipesFor(axeID, null, 1, fakeTable);
  console.log(axeRecipes);
  await craftWithTable(axeRecipes[0]);
};

// crafting something using a crafting table
async function craftWithTable(recipe, count = 1) {
  const airIDs = [
    mcData.blocksByName["air"].id,
    mcData.blocksByName["cave_air"].id
  ];
  getCraftingTable();
  // Find somewhere to put the crafting table.
  let solidBlocks = bot.findBlocks({
    matching: (block) => {
      return (!airIDs.includes(block.type));
    },
    count: 640,
    maxDistance: 10,
  });

  let craftingSpot;
  for (position of solidBlocks) {
    let block = bot.blockAt(position);
    let topBlock = bot.blockAt(block.position.offset(0, 1, 0));
    if (topBlock.type !== airIDs[0] && topBlock.type !== airIDs[1]) continue;
    if (bot.entity.position.xzDistanceTo(position) <= 2) continue;
    craftingSpot = block;
    break;
  }
  // Place the crafting table.
  if (!craftingSpot) {
    console.log("Couldn't find somewhere to put the crafting table.");
  }
  let tablePosition = craftingSpot.position;
  bot.pathfinder.setMovements(delicateMove);
  currentGoal = new GoalNearXZ(tablePosition.x, tablePosition.z, 2);
  await bot.pathfinder.goto(currentGoal).catch(console.log);
  await bot.equip(tableID);
  await bot.placeBlock(craftingSpot, { x: 0, y: 1, z: 0 }).catch(console.log);
  console.log("Placed the table! (maybe)");
  await bot.waitForTicks(1);
  let table = bot.findBlock({
    matching: (block) => {
      return block.name === "crafting_table";
    },
    maxDistance: 4,
  });
  await bot.craft(recipe, count, table);
  await bot.waitForTicks(1);
  // TODO: change if the bot keeps punching holes in the farmland
  await bot.collectBlock.collect(table, true).catch(console.log);
  currentGoal = null;
}

// if we don't have planks
// if we don't have logs, look for logs
// craft planks from logs
// craft table from planks
async function getCraftingTable(count = 1) {
  while (countInventory("crafting_table") < count) {
    // check to see if we actually have any planks
    // otherwise attempt to craft/obtain each type of plank
    await getPlanks(4);
    // we should have >= 4 planks of some kind at this point
    // after all this, we can attempt to craft a table
    tableRecipes = bot.recipesFor(tableID, null, 1, null);
    await bot.craft(tableRecipes[0]);
    await bot.waitForTicks(1);
    await bot.equip(mcData.itemsByName["crafting_table"].id)
  }
};

// acquire sticks
async function getSticks(count) {
  const stickID = mcData.itemsByName['stick'].id;
  while (countInventory("stick") < count) {
    await getPlanks(2);
    let stickRecipes = bot.recipesFor(stickID, null, 1, null);
    await bot.craft(stickRecipes[0]);
    await bot.waitForTicks(1);
  }
}

// acquire planks
async function getPlanks(count) {
  while (countMulti(plankIDs) < count) {
    await getLog(1);
    // we should have a log now hehe
    // attempt to craft each plank recipe and exit at the first successful one
    let plankRecipe;
    plankIDs.some(plank => {
      let plankRecipes = bot.recipesFor(plank, null, 1, null);
      if (plankRecipes.length > 0) {
        plankRecipe = plankRecipes[0];
        return true;
      }
    });
    await bot.craft(plankRecipe);
    await bot.waitForTicks(1);
  }
}

// acquire log
// but basically we're gonna try cut down the whole tree
// otherwise it looks messy
async function getLog(count = 1) {
  const TREE_ADJACENT = [ // doesn't work lmao, ruined by fancy oaks
    [0, -1, 0],
    [-1, -1, 0],
    [1, -1, 0],
    [0, -1, -1],
    [0, -1, 1],

    [-1, 0, 0],
    [1, 0, 0],
    [0, 0, -1],
    [0, 0, 1],

    [0, 1, 0],
    [-1, 1, 0],
    [1, 1, 0],
    [0, 1, -1],
    [0, 1, 1],
  ];
  console.log("Going woodcutting...");
  while (countMulti(logItemIDs) < count) {
    let logSearch = bot.findBlocks({
      matching: logBlockIDs,
      maxDistance: 64
      // count: 1 // default
    })
    if (logSearch.length < 1) {
      console.log("No logs found");
      return "No logs found";
    }
    // recursively check for adjacent logs, comprising a tree
    // then chop the big boi
    let toChop = [];
    let discard = [];
    while (logSearch.length > 0) {
      let candidatePos = logSearch.pop();
      let candidateBlock = bot.blockAt(candidatePos);
      if (logBlockIDs.includes(candidateBlock.type)) {
        toChop.push(candidatePos);
        TREE_ADJACENT.forEach(side => {
          let adjacent = candidatePos.offset(...side);
          if (!hasPosition(logSearch, adjacent)
            && !hasPosition(discard, adjacent)
            && !hasPosition(toChop, adjacent)) {
            logSearch.push(adjacent);
          }
        });
      } else {
        discard.push(candidatePos);
      }
    }
    toChop.sort((a, b) => a.y < b.y);
    for (let i = 0; i < toChop.length; i++) {
      // just in case the server has treecapitator
      if (!logBlockIDs.includes(bot.blockAt(toChop[i]).type)) continue;
      bot.pathfinder.setMovements(defaultMove);
      await bot.collectBlock.collect(bot.blockAt(toChop[i]), true)
        .catch(console.log);
    }
    while (countInventory("wooden_axe") < 2) await craftAxe();
  }
}

// wait till the bot picks up an item
function waitForPickup(itemID = null) {
  return new Promise((resolve) => {
    const listener = (player, entity) => {
      if (player === bot.entity
        && entity.name === 'item'
        && (itemID == null || entity.metadata["8"].itemId == itemID)) {
        // console.log(entity);
        bot.removeListener("playerCollect", listener);
        resolve();
      }
    }
    bot.on("playerCollect", listener);
  })
}

// used for planks and logs, get the highest count of each type
function countMulti(arrayIDs) {
  let count = 0;
  arrayIDs.forEach(id => {
    count = Math.max(count, countInventory(mcData.items[id].name));
  });
  return count;
}

// see if a vec3 of 
function hasPosition(array, test) {
  return array.some((element) => element.equals(test));
}

async function testCollect(type, count = 1) {
  const blockType = mcData.blocksByName[type];
  if (!blockType) {
    return;
  }

  const blocks = bot.findBlocks({
    matching: blockType.id,
    maxDistance: 64,
    count: count
  });

  if (blocks.length === 0) {
    console.log("I don't see that block nearby.");
    return;
  }

  const targets = [];
  for (let i = 0; i < Math.min(blocks.length, count); i++) {
    targets.push(bot.blockAt(blocks[i]));
  }

  console.log("Found ${targets.length} ${type}(s)");

  try {
    await bot.collectBlock.collect(targets);
    // All blocks have been collected.
    console.log('Done');
  } catch (err) {
    // An error occurred, report it.
    console.log(err.message);
    console.log(err);
  }
}

// check if bot has enough ingredients for any of the given recipes
// recipesFor will return nothing if we don't have enough
// so this isn't needed lol
function hasIngredientsForAny(recipe, craftingTable) {
};

/* 
loop:
get axe (if we don't already have one)
get hoe (if we don't already have one)
acquire seeds (if we don't already have some)
start tilling farmland and place crops
*/
