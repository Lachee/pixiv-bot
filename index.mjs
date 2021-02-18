import dotenv from 'dotenv'; dotenv.config();   // Load Enviroment
import { ShardClient } from 'detritus-client';
import  Enmap from 'enmap';
import log4js from 'log4js';
import createHmac from 'create-hmac';
import fetch from 'node-fetch';

//Prepare the logger
log4js.configure({
    appenders: { 
        file: { type: "file",  filename: "bot.log" },
        console: { type: 'console' }
    },
    categories: { 
        default: { 
            appenders: ["console", "file"], 
            level: "debug" 
        } 
    }
});
const logger = log4js.getLogger("default");

//Pixiv
const pixivPattern = /pixiv.net\/?\w*\/(\w*)\/(\d*)/;

/** Fetches a PIXIV illustration */
async function fetchIllustration(id) {
    const response  = await fetch(`https://www.pixiv.net/ajax/illust/${id}`, {});
    const data      = await response.json();
    if (data.error) {
        console.error('Failed ', data.message);
        return null;
    }

    const tags = data.body.tags.tags.map(t => t.tag);
    const pages = data.body.pageCount;

    let images = [];
    for(let i = 0; i < pages; i++) {
        const imageUrl = data.body.urls.original.replace("_p0", `_p${i}`);
        images.push(imageUrl);
    }

    return {
        id:             id,
        title:          data.body.title,
        description:    data.body.description,
        artist:         [ data.body.userName ],
        tags:           [ ...new Set(tags) ],
        url:            data.body.extraData.meta.canonical,
        images:         images,
    };
}

  
/** Generates a proxy url */
function proxy(url, ext = 'jpg') {
    const key   = process.env.PROXY_KEY;
    const salt  = process.env.PROXY_SALT;

    const hexDecode = (hex) => Buffer.from(hex, 'hex');
    const urlSafeBase64 = (string) => Buffer.from(string).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    let resize      = 'fit';
    let width       = 0;
    let height      = 0;
    let gravity     = 'no';
    let enlarge     = 1;
    let extension   = ext;

    //Get the path
    const encodedUrl    = urlSafeBase64(url);
    const path          = `/${resize}/${width}/${height}/${gravity}/${enlarge}/${encodedUrl}.${extension}`;
    
    //Get the signature
    const hmac = createHmac('sha256', hexDecode(key))
    hmac.update(hexDecode(salt));
    hmac.update(path);
    const signature = urlSafeBase64(hmac.digest());

    //Build the response
    return `${process.env.PROXY_URL}${signature}${path}`;
}


//Prepare detritus
const client = new ShardClient(process.env.BOT_TOKEN, {
    gateway: { loadAllMembers: false }
});

const webhooks = new Enmap({
    name: 'webhooks',
    fetchAll: true,
    autoFetch: true,
    cloneLevel: 'deep',
});

// listen to our client's eventemitter
client.on('messageCreate', async ({message}) => {
    if (message.author.bot) return;

    const matches = message.content.match(pixivPattern);
    if (matches == null || matches.length < 3) return;
    

    //Fetch the illustration
    const illustration = await fetchIllustration(matches[2]);
    if (illustration.images.length == 0) return;

    //Return the image
    const image = illustration.images[0];
    const url = proxy(image);

    let webhook = null;

    //Get the webhook
    if (!webhooks.has(message.channelId)) {
        if (message.channel.canManageWebhooks())
            webhook = await createWebhook(message.channelId);
    } else {
        const webhookId = webhooks.get(message.channelId);
        webhook = await client.rest.fetchWebhook(webhookId);

        //Failed to find a webhook, create it anyways.
        if (webhook == null)
            if (message.channel.canManageWebhooks())
                webhook = await createWebhook(message.channelId);
    }

    //Supress
    try { message.suppressEmbeds(true); } catch(e) { /** ignore any error */}

    //Failed to get any webhook, lets just respond
    if (webhook == null) {
        await message.reply(url);
        return;
    }

    //Execute the webhook
    await webhook.execute({
        content: url,
        username: message.author.username,
        avatarUrl: `https://d.lu.je/avatar/${message.author.id}`
    });
});

/** Creates a webhook */
async function createWebhook(channelId) {
    const webhook = await client.rest.createWebhook(channelId, {
        name: "Pixiv Webhook",
        avatar: "https://i.imgur.com/aBpeQki.jpg"
    });

    if (webhook) webhooks.set(channelId, webhook.id);
    return webhook;
}

// listen to our client's eventemitter
client.on('guildCreate', async ({fromUnavailable, guild}) => {
    if (fromUnavailable) {
      logger.info(`Guild ${guild.name} has just came back from being unavailable`);
    } else {
      logger.info(`Joined Guild ${guild.name}, bringing us up to ${client.guilds.length} guilds.`);
    }
});
  
//Run the bot
(async() => {
    await client.run();
    logger.info('Successfully conected to discord!');
    client.gateway.setPresence({
        activity: {
          name: 'with Detritus',
          type: 0,
        },
        status: 'dnd',
      });
})();