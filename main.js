const mineflayer = require('mineflayer')
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder')

const bot = mineflayer.createBot({
    host: process.argv[2],
    port: parseInt(process.argv[3]),
    username: process.argv[4],
    password: process.argv[5]
})

const RANGE_GOAL = 1 // get within this radius of the player

bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
    mineflayerViewer(bot, { port: 3007, firstPerson: false }) // port is the minecraft server port, if first person is false, you get a bird's-eye view
    const defaultMove = new Movements(bot)

    bot.on('chat', (username, message) => {
        if (username === bot.username) return // i.e. ignore own messages
        if (message !== 'cmere') return
        const target = bot.players[username]?.entity
        if (!target) {
            bot.chat("I don't see you !")
            return
        }
        const { x: playerX, y: playerY, z: playerZ } = target.position

        bot.pathfinder.setMovements(defaultMove)
        bot.pathfinder.setGoal(new GoalNear(playerX, playerY, playerZ, RANGE_GOAL))
    })
})