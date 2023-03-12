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
let mcData; // gets loaded after bot joins server (version unknown)
let currentGoal = null;

bot.once('spawn', async () => {
    console.log("Joined server!");
    mcData = require('minecraft-data')(bot.version);
    mineflayerViewer(bot, { port: 3007, firstPerson: false }); // port is the minecraft server port, if first person is false, you get a bird's-eye view
    defaultMove = new Movements(bot); // contains settings/config about the pathfinder
    defaultMove.canDig = false;
    defaultMove.placeCost = 9999;
    bot.pathfinder.setMovements(defaultMove);
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
    bot.pathfinder.setGoal(new GoalNear(playerX, playerY, playerZ, RANGE_GOAL));
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
        await bot.pathfinder.goto(currentGoal);
        currentGoal = null;
        await equipHoe(); // maybe this should happen at the start
        await bot.activateBlock(bot.blockAt(dirt)); // till the dirt
    }
})

function checkInventory(itemName) {
    let items = bot.inventory.items();
    return items.filter(item => item.name === itemName).length;
}

async function equipHoe() {
    if (!checkInventory("wooden_hoe")) console.log("No hoes :c");
    if (!bot.heldItem || bot.heldItem.name != "wooden_hoe") await bot.equip(mcData.itemsByName["wooden_hoe"].id);
};

/* 
loop:
get axe (if we don't already have one)
get hoe (if we don't already have one)
acquire seeds (if we don't already have some)
start tilling farmland and place crops
*/
