// by Corns McGowan
// This bot tries to make a wheat farm and expand it nonstop

const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { pathfinder, Movements, goals: { GoalNear, GoalNearXZ, GoalPlaceBlock, GoalLookAtBlock } } = require('mineflayer-pathfinder');

const vec3 = require('vec3');

const RANGE_GOAL = 1; // get within this radius of the player

const bot = mineflayer.createBot({
    host: process.argv[2],
    port: parseInt(process.argv[3]),
    username: process.argv[4],
    password: process.argv[5]
});

bot.loadPlugin(require('mineflayer-collectblock').plugin);
bot.loadPlugin(pathfinder);

bot.on('kicked', (reason, loggedIn) => console.log(reason, loggedIn));
bot.on('end', (reason) => console.log(reason));
bot.on('error', err => console.log(err));

// spots to check when analysing tree blocks
// i have no clue if its vec3 or vec3.Vec3
const TREE_ADJACENT = [
    vec3(0, -1, 0),
    vec3(-1, -1, 0),
    vec3(1, -1, 0),
    vec3(0, -1, -1),
    vec3(0, -1, 1),

    vec3(-1, 0, 0),
    vec3(1, 0, 0),
    vec3(0, 0, -1),
    vec3(0, 0, 1),

    vec3(0, 1, 0),
    vec3(-1, 1, 0),
    vec3(1, 1, 0),
    vec3(0, 1, -1),
    vec3(0, 1, 1),
];

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

bot.once('spawn', async () => {
    console.log("Joined server!");
    mcData = require('minecraft-data')(bot.version);
    mineflayerViewer(bot, { port: 3007, firstPerson: false }); // port is the minecraft server port, if first person is false, you get a bird's-eye view
    defaultMove = new Movements(bot); // contains settings/config about the pathfinder
    delicateMove = new Movements(bot);
    delicateMove.canDig = false;
    delicateMove.placeCost = 9999;

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
            logBlockIDs.push(mcData.blocksByName[mcData.items[logRecipe.delta[0].id].name].id);
        });
    });
});

bot.on('chat', async (username, message) => {
    console.log("chat", username, message);
    if (username === bot.username) return; // i.e. ignore own messages
    const ARGS = message.split(' ');
    switch (ARGS[0]) {
        case "cmere":
            const target = bot.players[username]?.entity;
            if (!target) {
                console.log("Target not found :c");
                return;
            }
            const { x: playerX, y: playerY, z: playerZ } = target.position;
            bot.pathfinder.setMovements(delicateMove);
            await bot.pathfinder.goto(new GoalNear(playerX, playerY, playerZ, RANGE_GOAL)).catch(console.log);
            break
        case "log":
            await getLog();
            break;
        case "collect":
            let count = 1;
            if (ARGS.length === 3) count = parseInt(ARGS[1]);
            let type = ARGS[1];
            if (ARGS.length === 3) type = ARGS[2];
            await testCollect(type, count);
            break;
    }
})

bot.on('whisper', async (username, message) => {
    console.log("whisper", username, message);
});

bot.on('itemDrop', async (entity) => {
    if (mcData == null || entity.name !== "item") return;
    console.log("itemdrop", mcData.items[entity.metadata["8"].itemId].name);
});

bot.on('blockUpdate', async (oldBlock, newBlock) => {
    // console.log('blockUpdate', oldBlock, newBlock)
    // replace trampled/decayed farmland if we encounter any
    // bot moves so it can view the top of the farmland to also replace crops
    // todo: maybe distinguish between player-trampled farmland and decaying farmland further away?
    /*
    if (currentGoal == null
        && oldBlock.name === "farmland" && newBlock.name === "dirt") {
        console.log("Farmland decayed/trampled :c");
        let dirt = newBlock.position
        currentGoal = new GoalNear(dirt.x, dirt.y + 1, dirt.z, RANGE_GOAL);
        await equipHoe(); // maybe this should happen at the start
        bot.pathfinder.setMovements(delicateMove);
        await bot.pathfinder.goto(currentGoal).catch(console.log);
        await bot.lookAt(dirt, true);
        await bot.activateBlock(bot.blockAt(dirt)); // till the dirt
        currentGoal = null;
    }
    //*/
})

// returns number of matching items/blocks
function countInventory(itemName) {
    let items = bot.inventory.items();
    itemResult = items.filter(item => item.name === itemName);
    return itemResult.reduce((subtotal, item) => subtotal + item.count, 0);
};

async function equipHoe() {
    if (countInventory("wooden_hoe") < 1) await craftHoe();
    if (!bot.heldItem || bot.heldItem.name != "wooden_hoe") await bot.equip(mcData.itemsByName["wooden_hoe"].id);
};

// attempt to craft a hoe
// assumes vanilla crafting recipes as of Java 1.19.3
async function craftHoe(count = 1) {
    let hoeID = mcData.itemsByName["wooden_hoe"].id;
    // check we have sticks, planks and a table (and acquire them if we don't)
    await getCraftingTable();
    await getSticks(2);
    await getPlanks(2);
    let hoeRecipes = bot.recipesFor(hoeID, null, 1, fakeTable);
    console.log(hoeRecipes);
    await craftWithTable(hoeRecipes[0]);
};

async function craftAxe(count = 1) {
    let axeID = mcData.itemsByName["wooden_axe"].id;
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
    airIDs = [mcData.blocksByName["air"].id, mcData.blocksByName["cave_air"].id];
    getCraftingTable();
    // Find somewhere to put the crafting table.
    let solidBlocks = bot.findBlocks({
        matching: (block) => {
            return block.type !== airIDs[0] && block.type !== airIDs[1];
        },
        count: 64,
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
    if (!craftingSpot) console.log("Couldn't find somewhere to put the crafting table.");
    let tablePosition = craftingSpot.position;
    await bot.equip(tableID);
    currentGoal = new GoalNearXZ(tablePosition.x, tablePosition.z, 2);
    await bot.pathfinder.goto(currentGoal).catch(console.log);
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
    await bot.collectBlock.collect(table);
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
        await bot.equip(mcData.itemsByName["crafting_table"].id)
    }
};

// acquire sticks
async function getSticks(count) {
    let stickID = mcData.itemsByName['stick'].id;
    while (countInventory("stick") < count) {
        await getPlanks(2);
        let stickRecipes = bot.recipesFor(stickID, null, 1, null);
        await bot.craft(stickRecipes[0]);
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
    }
}

// acquire log
// but basically we're gonna try cut down the whole tree
// otherwise it looks messy
async function getLog(count = 1) {
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
                TREE_ADJACENT.forEach(elem => {
                    let adjacent = candidatePos.offset(elem.x, elem.y, elem.z);
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
            await bot.collectBlock.collect(bot.blockAt(toChop[i])).catch(console.log); // replaces everything below omg
        }
        while (countInventory("wooden_axe") < 2) await craftAxe();
    }
}

// wait till the bot picks up an item
function waitForPickup(itemID) {
    return new Promise((resolve) => {
        const listener = (player, entity) => {
            if (entity.name === 'item'
                // && entity.entityType === itemID // not sure why this isn't working as expected
                && player === bot.entity) {
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
    const blockType = mcData.blocksByName[type]
    if (!blockType) {
        return
    }

    const blocks = bot.findBlocks({
        matching: blockType.id,
        maxDistance: 64,
        count: count
    })

    if (blocks.length === 0) {
        bot.chat("I don't see that block nearby.")
        return
    }

    const targets = []
    for (let i = 0; i < Math.min(blocks.length, count); i++) {
        targets.push(bot.blockAt(blocks[i]))
    }

    bot.chat(`Found ${targets.length} ${type}(s)`)

    try {
        await bot.collectBlock.collect(targets)
        // All blocks have been collected.
        bot.chat('Done')
    } catch (err) {
        // An error occurred, report it.
        bot.chat(err.message)
        console.log(err)
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
