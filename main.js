const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { pathfinder, Movements, goals: { GoalNear, GoalPlaceBlock, GoalLookAtBlock } } = require('mineflayer-pathfinder');
const vec3 = require('vec3');

const RANGE_GOAL = 1; // get within this radius of the player

const bot = mineflayer.createBot({
    host: process.argv[2],
    port: parseInt(process.argv[3]),
    username: process.argv[4],
    password: process.argv[5]
});

bot.on('kicked', (reason, loggedIn) => console.log(reason, loggedIn));
bot.on('end', (reason) => console.log(reason));
bot.on('error', err => console.log(err));

bot.loadPlugin(pathfinder);

let defaultMove;
let delicateMove;
let mcData; // gets loaded after bot joins server (version unknown)
let currentGoal = null;
let fakeTable = { id: 'minecraft:crafting_table' }

bot.once('spawn', async () => {
    console.log("Joined server!");
    mcData = require('minecraft-data')(bot.version);
    mineflayerViewer(bot, { port: 3007, firstPerson: false }); // port is the minecraft server port, if first person is false, you get a bird's-eye view
    defaultMove = new Movements(bot); // contains settings/config about the pathfinder
    delicateMove = new Movements(bot);
    delicateMove.canDig = false;
    delicateMove.placeCost = 9999;
});

bot.on('chat', async (username, message) => {
    console.log("chat", username, message);
    if (username === bot.username) return; // i.e. ignore own messages
    if (message !== "cmere") return;
    const target = bot.players[username]?.entity;
    if (!target) {
        console.log("Target not found :c");
        return;
    }
    const { x: playerX, y: playerY, z: playerZ } = target.position;
    bot.pathfinder.setMovements(delicateMove);
    bot.pathfinder.goto(new GoalNear(playerX, playerY, playerZ, RANGE_GOAL));
})

bot.on('whisper', async (username, message) => {
    console.log("whisper", username, message);
});

bot.on('blockUpdate', async (oldBlock, newBlock) => {
    // console.log('blockUpdate', oldBlock, newBlock)
    // replace trampled/decayed farmland if we encounter any
    // bot moves so it can view the top of the farmland to also replace crops
    // todo: maybe distinguish between player-trampled farmland and decaying farmland further away?
    if (currentGoal == null
        && oldBlock.name === "farmland" && newBlock.name === "dirt") {
        console.log("Farmland decayed/trampled :c");
        let dirt = newBlock.position
        currentGoal = new GoalNear(dirt.x, dirt.y + 1, dirt.z, RANGE_GOAL);
        bot.pathfinder.setMovements(delicateMove);
        await bot.pathfinder.goto(currentGoal);
        currentGoal = null;
        await equipHoe(); // maybe this should happen at the start
        await bot.activateBlock(bot.blockAt(dirt)); // till the dirt
    }
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
    let hoeRecipes = bot.recipesAll(hoeID, null, fakeTable);

    // check we have sticks, planks and a table (and acquire them if we don't)
    if (countInventory("crafting_table") < 1) await craftCraftingTable();
    if (countInventory("sticks") < count * 2) await craftSticks();
    if (countInventory("sticks") < count * 2) await craftSticks();
    let stickID = mcData.itemsByName['stick'].id;
    let stickRecipes = bot.recipesAll(stickID, null, null);

    console.log(hoeRecipes);

};

async function craftCraftingTable() {
    let tableID = mcData.itemsByName["crafting_table"].id;
    let tableRecipes = bot.recipesAll(tableID, null, null);

    // get a list of planks needed
    let plankIDs = tableRecipes.reduce((plankArray, recipe) => {
        plankArray.push(recipe.delta[0].id);
        return plankArray;
    }, []);
    // check to see if we actually have any planks
    let plankCount = 0;
    let logItemIDs = [];
    let logBlockIDs = [];
    plankIDs.forEach(plank => {
        plankCount = Math.max(plankCount, countInventory(mcData.items[plank].name));
        // also get a list of all logs used to craft the planks while we're here
        bot.recipesAll(plank, null, null).forEach(logRecipe => {
            logItemIDs.push(logRecipe.delta[0].id);
            // convert item to block
            logBlockIDs.push(mcData.blocksByName[mcData.items[logRecipe.delta[0].id].name].id);
        });
    });
    // otherwise attempt to craft/obtain each type of plank
    if (plankCount < 4) {
        // find the nearest log
        // punch it
        let logs = bot.findBlocks({
            matching: logBlockIDs,
            maxDistance: 16
        })
        if (logs.length < 1) {
            console.log("No logs found");
            return;
        }
        let log = bot.blockAt(logs[0]);
        currentGoal = new GoalLookAtBlock(logs[0], bot.world);
        bot.pathfinder.setMovements(defaultMove);
        await bot.pathfinder.goto(currentGoal);
        await bot.dig(log);
        await getPromiseFromEvent(bot, "playerCollect");
    }
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
    // we should have >= 4 planks of some kind at this point
    // after all this, we can attempt to craft a table
    tableRecipes = bot.recipesFor(tableID, null, 1, null);
    await bot.craft(tableRecipes[0]);
    await bot.equip(mcData.itemsByName["crafting_table"].id)
};

// subscribe to an event and then return when it fires
function getPromiseFromEvent(item, event) {
    return new Promise((resolve) => {
        const listener = () => {
            item.removeListener(event, listener);
            resolve();
        }
        item.on(event, listener);
    })
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
