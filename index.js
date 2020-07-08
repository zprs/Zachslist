const fs = require("fs");
var path = require('path');
var CronJob = require('cron').CronJob;

const puppeteer = require('puppeteer-core');
const chromePath = setChromePath();
var browserWSEndpoint = null;
spawnPuppeteerBrowser();

var nodeCleanup = require('node-cleanup');
const nodemailer = require('nodemailer');

var express = require('express');
const { send } = require("process");
var app = express();
app.use(express.static('public'));

const port = process.env.PORT || 3000;
var server = app.listen(port, "0.0.0.0");

var io = require('socket.io')(server);
console.log(`App started. Running on port ${ port }`);

// var makeSearchesCron = new CronJob('* * * * *', function() {
//     makeSearches();
// }, null, true, 'America/Los_Angeles');
  

function makeSearches()
{
    var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));
    
    var emails = Object.keys(obj);

    for (let i = 0; i < emails.length; i++) {
        const email = emails[i];

        var savedSearches = obj[email];
        
        for (let x = 0; x < savedSearches.length; x++) {
            const search = savedSearches[x];

            if(search.emailOnSpecial)
            {
                filterSpecialSearches(email, search, obj)
            }
        }
    }
}

async function filterSpecialSearches(email, search, oldObj)
{
    var obj = oldObj;
    var previousSpecials = search.previousSpecials || [];
    var newSpecials = [];

    var returnedData = await scrapeWebsites(search);

    for (let y = 0; y < returnedData.data.length; y++) {
        const listing = returnedData.data[y];

        var wasPreviouslyFound = false;

        for (let n = 0; n < previousSpecials.length; n++) {
            const previousSpecial = previousSpecials[n];

            if(previousSpecial.description == listing.description && previousSpecial.price == listing.price && previousSpecial.imageSrc == listing.imageSrc)
            {
                console.log("special prevoiusly found ... skipping");
                wasPreviouslyFound = true;
                break;
            }
            
        }

        if(wasPreviouslyFound)
            continue;

        var includesTerm = false;

        for (let z = 0; z < search.specialTerms.length; z++) {
            const term = search.specialTerms[z];

            if(listing.description.toLowerCase().includes(term.toLowerCase()))
            {
                console.log("new special! : " + listing.description);
                newSpecials.push(listing);
                includesTerm = true;
                break;
            }
        }

        if(includesTerm == true)
            break;  
    }

    if(search.previousSpecials)
        search.previousSpecials = search.previousSpecials.concat(newSpecials);
    else
        search.previousSpecials = newSpecials;

    if(newSpecials.length > 0)
        sendSpecialUpdate(email, newSpecials);

    fs.writeFileSync('savedSearches.json', JSON.stringify(obj),{encoding:'utf8'});
}


function sendSpecialUpdate(email, specials)
{

    var text = "There are " + specials.length + " new listings that include one of your special search terms: ";

    for (let i = 0; i < specials.length; i++) {
        const special = specials[i];

        text += special.description + ", " + special.price;
    }

    subject = specials.length + " new special listing(s)";

    sendMail(email, subject, text);
}


io.sockets.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('ping', () => 
    {
        socket.emit("ping");
    });

    socket.on('updateSavedSearch', function(data) {
        var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));
        var previousData = obj[data.email];

        for (let i = 0; i < previousData.length; i++) {
            const prevObj = previousData[i];

            console.log(data);

            if(prevObj.id == data.id)
                obj[data.email][i] = data;
        }

        fs.writeFileSync('savedSearches.json',JSON.stringify(obj),{encoding:'utf8'});
    });

    socket.on('deleteSavedSearch', function(data) {
        var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));
        var previousData = obj[data.email];

        for (let i = 0; i < previousData.length; i++) {
            const prevObj = previousData[i];

            if(prevObj.id == data.id)
            {
                previousData.splice(i, 1);
                break;
            }
        }

        if(previousData.length == 0)
            delete obj[data.email];

        fs.writeFileSync('savedSearches.json',JSON.stringify(obj),{encoding:'utf8'});
    });

    socket.on('search', function(data) {

        if(data.searchFromId)
        {
            var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));

            var keys = Object.keys(obj);

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                
                var savedSearchArray = obj[key];

                var doubleBreak = false;

                for (let x = 0; x < savedSearchArray.length; x++) {
                    const search = savedSearchArray[x];

                    if(search.id == data.searchId)
                    {
                        data = search;
                        doubleBreak = true;
                        break;
                    }
                }

                if(doubleBreak)
                    break;
            }
        }

        if(data.saveSearch)
        {
            var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));
            var previousData = obj[data.email];
            
            if(previousData) {

                var isDuplicate = false;

                for (let i = 0; i < previousData.length; i++) {
                    const prevObj = previousData[i];

                    console.log(JSON.stringify(prevObj));
                    console.log(JSON.stringify(data));

                    if(isEquivalent(data, prevObj))
                    {
                        isDuplicate = true;
                        break;
                    }
                }

                if(!isDuplicate)
                {
                    data.id = uniqueId();
                    previousData.push(data);
                }
            }
            else //No searches have been recorded for this email
            {
                data.id = uniqueId();
                obj[data.email] = [data];
            }

            fs.writeFileSync('savedSearches.json',JSON.stringify(obj),{encoding:'utf8'});
        }

        (async () => {
            var returnedData = await scrapeWebsites(data);
            socket.emit("scrape", {scrapeData: returnedData.data, urls: returnedData.urls, filters: data});
          })(); 

    });

    socket.on('viewSavedSearches', function(data) {
    
        var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));

        if(obj[data.email] != null)
            socket.emit("loadSavedSearches", obj[data.email]);
        else
            socket.emit("noSavedSearches");
    });
    
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});

async function spawnPuppeteerBrowser()
{
    const args = [
        '--disable-gpu',
        '--no-sandbox',
        '--mute-audio',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--proxy-server="direct://"',
        '--proxy-bypass-list=*',
        '--no-zygote',
        '--user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36"'
    ];

    const options = {
        executablePath: chromePath,
        args: args,
        headless: true,
        devtools: false,
        ignoreHTTPSErrors: true,
        userDataDir: path.resolve('tmp')
    };

    let browser = await puppeteer.launch(options);
    browserWSEndpoint = browser.wsEndpoint();
    browser.disconnect();

    console.log("Puppeter Started");

    makeSearches();
}

async function scrapeWebsites(data)
{
    console.log("scrape request recieved");

    const start = Date.now();

    try
    {
        browser = await puppeteer.connect({browserWSEndpoint});   
        console.log("Browser connected");
        // const preloadFile = fs.readFileSync('./preload.js', 'utf8');
    
        let page = await browser.newPage();
        // await page.setViewport({ width: 400, height: 500 });
        await page.setRequestInterception(true);

        var lastTime = Date.now();
        page.on('request', (req) => {

            if(req.resourceType() === 'stylesheet' || req.resourceType() === 'font' || req.resourceType() === 'image'){
                req.abort();
            }
            else {
                req.continue();
            }
        });
    
        // await page.evaluateOnNewDocument(preloadFile);
        page.on('load', () => console.log("Loaded: " + page.url()));

        //Craigslist Scrape -----------------
        let craigslistURL = craigslistLinkGen(data.minPrice, data.maxPrice, data.zip, data.radius, data.positiveTerms, data.negitiveTerms);
        console.log("Go to CL");
        await page.goto(craigslistURL, { waitUntil: 'networkidle0', timeout: 15000});
        let CLScrapeData = await page.evaluate(extractCLItems);
    
        console.log("Finised CL scrape");
    
        //Offer Up Scrape -------------------
        let offerUpURL = offerUpLinkGen(data.minPrice, data.maxPrice, data.radius, data.positiveTerms);
        await page.goto(offerUpURL, { waitUntil: 'networkidle0', timeout: 15000});
        
        let OUScrapeData = await scrapeInfiniteScrollItems(page, extractOUItems, 50, data);
    
        console.log("Finised OU scrape");
    
        //FBMP Scrape -------------------
        let fbmpURL = facebookMPLinkGen(data.minPrice, data.maxPrice, data.radius, data.positiveTerms);
        await page.goto(fbmpURL, { waitUntil: 'networkidle0', timeout: 15000});
    
        let FBMPScrapeData = await scrapeInfiniteScrollItems(page, extractFBMPItems, 50, data);
        
        console.log("Finised FBMP scrape");
    
        var totalNumberScraped = CLScrapeData.length + OUScrapeData.length + FBMPScrapeData.length;
        var combinedData = [];
    
        console.log("Finished scraping");
    
        for (let i = 0; i < totalNumberScraped; i++) {
            if(i < CLScrapeData.length)
                combinedData.push(CLScrapeData[i]);
            if(i < OUScrapeData.length)
                combinedData.push(OUScrapeData[i]);
            if(i < FBMPScrapeData.length)
                combinedData.push(FBMPScrapeData[i]);
        }
    
        console.log("Finised combining scrapes");

        await page.close();
        await browser.disconnect();

        console.log('Took', Date.now() - start, 'ms');
        return {data: combinedData, urls: [craigslistURL, offerUpURL, fbmpURL]};
    }
    catch(error)
    {
        console.log("Caught webscraping error:  " + error);
    }
}

function craigslistLinkGen(minPrice, maxPrice, zip, radius, positiveTerms, negitiveTerms)
{
    if(radius > 40000)
        radius = 40000;

    var query = "";

    var numberOfTerms = positiveTerms.length + negitiveTerms.length;

    var posTerms = positiveTerms;
    var negTerms = negitiveTerms;

    if(numberOfTerms > 20)
    {
        var percentPositive = positiveTerms.length / numberOfTerms;
        var numberPositive = Math.round(percentPositive * 20);

        posTerms = positiveTerms.slice(0, numberPositive);
        negTerms = negitiveTerms.slice(0, 20 - numberPositive);
    }
    

    for (let i = 0; i < posTerms.length; i++) {
        const term = posTerms[i];

        if(i > 0)
            query +="+"

        query += term;
    }

    for (let i = 0; i < negTerms.length; i++) {
        const term = negTerms[i];

        if(i > 0 || query != "")
            query +="+"

        query += "-" + term;        
    }
    
    zip = 92663;
    return `https://orangecounty.craigslist.org/search/bia?sort=date&hasPic=1&bundleDuplicates=1&max_price=${maxPrice}&min_price=${minPrice}&postal=${zip}&query=${query}&search_distance=${radius}`;
}

function offerUpLinkGen(minPrice, maxPrice, radius, positiveTerms)
{
    if(radius > 50)
        radius = 50;
    
    var query = "";

    for (let i = 0; i < positiveTerms.length; i++) {
        const term = positiveTerms[i];

        if(i > 0)
            query +="%20"

        query += term;
    }

    return `https://offerup.com/explore/k/bicycles/?q=${query}&price_min=${minPrice}&price_max=${maxPrice}&radius=${radius}`;
}

function facebookMPLinkGen(minPrice, maxPrice, radius, positiveTerms)
{
//https://www.facebook.com/marketplace/105545799477946/bicycles/?minPrice=5&maxPrice=150&exact=false&query=blue
    //https://www.facebook.com/marketplace/105545799477946/search/?minPrice=30&maxPrice=100&sortBy=creation_time_descend&query=red&category_id=bicycles&exact=false`;

    if(radius > 500)
        radius = 500;

    if(maxPrice > 999999999)
        maxPrice = 999999999;

    var query = "";

    for (let i = 0; i < positiveTerms.length; i++) {
        const term = positiveTerms[i];

        if(i > 0)
            query +="%20"

        query += term;
    }
    return `https://www.facebook.com/marketplace/105545799477946/bicycles/?minPrice=${minPrice}&maxPrice=${maxPrice}&exact=false&query=${query}`
}

///Mailer
function sendMail(to, subject, text){

    
    var obj = JSON.parse(fs.readFileSync('emailCredentials.json', 'utf8'));

    var senderEmail = obj.email;

    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: senderEmail,
          pass: obj.pass
        }
      });
      
      var mailOptions = {
        from: senderEmail,
        to: to,
        subject: subject,
        text: text
        //html: html
      };
      
      transporter.sendMail(mailOptions, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });

}

async function scrapeInfiniteScrollItems(page, extractItems, itemTargetCount, filters, scrollStep = 200, scrollDelay = 0, maxItterations = 1700) {
    let items = [];

    var scrollDistance = 0;
    var itemsStillNeedToLoad = true;

    var numberOfItterations = 0;
    var lastLog;

    while ((items.length < itemTargetCount || itemsStillNeedToLoad) && numberOfItterations < maxItterations) {

        if(items.length < itemTargetCount)
        {
            newItems = await page.evaluate(extractItems);

            newItems.forEach(newItem => {

                if(newItem.imageSrc != "https://assets.offerup.com/web/images/placeholder.c791e19f.png")
                {
                    var filteredOut = false;

                    for (let x = 0; x < filters.negitiveTerms.length; x++) {
                        const term = filters.negitiveTerms[x];
            
                        if(newItem.description.toLowerCase().includes(term.toLowerCase(term)))
                        {
                            filteredOut = true;
                            break;
                        }
                    }
                    
                    //If it is not filtered out by the search terms, go on to make sure it is not a duplicate
                    if(!filteredOut)
                    {
                        var isDuplicate = false;
            
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            if(isEquivalent(newItem, item))
                            {
                                isDuplicate = true;
                                break;
                            }
                        }
                        
                        if(!isDuplicate && items.length < itemTargetCount)
                            items.push(newItem);
                    }

                }
            });
        }
        
        await page.evaluate(`window.scrollTo(0, ${scrollDistance})`);
        // await page.waitForFunction(`document.body.scrollHeight > ${scrollDistance}`);

        scrollDistance += scrollStep;
        
        await page.evaluate(() => {
            // click load more on OU
            var loadModeButton = document.querySelector("._1kjvp19  .ou-btn-special");
            if(loadModeButton)
                loadModeButton.click();
        });

        await page.waitFor(scrollDelay);

        if(items.length % 10 == 0 && lastLog != items.length)
        {
            lastLog = items.length;
            console.log(items.length);
        } 

        if(items.length > 0)
            itemsStillNeedToLoad = items[items.length - 1].posY > scrollDistance;

        numberOfItterations++;
    }

    console.log("Finished Infinite Scroll Scrape -------")

    return items;
}

function extractCLItems() {
    let listingsRaw = document.getElementsByClassName("result-row");
    var listings = [];

    for(var i = 0;  i < listingsRaw.length; i++)
    {
        var link = listingsRaw[i].getElementsByClassName("result-image")[0].href;

        var image = listingsRaw[i].getElementsByTagName("img")[0];
        var imageSrc = image ? image.src : "";
        var price = listingsRaw[i].getElementsByClassName("result-price")[0].innerText;
        var description = listingsRaw[i].getElementsByClassName("result-title")[0].innerText;
        var date = listingsRaw[i].getElementsByClassName("result-date")[0].datetime;

        listings.push({
            link: link,
            imageSrc: imageSrc,
            price: price,
            description: description,
            date: date
        });
    }

    return listings;
}

function extractOUItems() {

    let listingsRaw = document.getElementsByClassName("_109rpto");
    var listings = [];

    for(var i = 0;  i < listingsRaw.length; i++)
    {   

        if(!listingsRaw[i].getElementsByClassName("_s3g03e4")[0] || !listingsRaw[i].getElementsByClassName("_nn5xny4")[0] || !listingsRaw[i].getElementsByClassName("_19rx43s2")[0]) 
            continue;

        var link = listingsRaw[i].href;

        var image = listingsRaw[i].getElementsByTagName("img")[0];
        var imageSrc = image ? image.src : "";
        var price = listingsRaw[i].getElementsByClassName("_s3g03e4")[0].innerText;
        var description = listingsRaw[i].getElementsByClassName("_nn5xny4")[0].innerText;
        var posY = listingsRaw[i].offsetTop;
        var locaition = listingsRaw[i].getElementsByClassName("_19rx43s2")[0].innerText;
        
        listings.push({
            link: link,
            imageSrc: imageSrc,
            price: price,
            description: description,
            locaition: locaition,
            posY: posY
        });
    }

    return listings;
}

function extractFBMPItems() {

    let listingsRaw = document.getElementsByClassName("hyh9befq");
    var listings = [];

    for(var i = 0;  i < listingsRaw.length; i++)
    {   

        if(!listingsRaw[i].getElementsByClassName("oi732d6d")[0] || !listingsRaw[i].getElementsByClassName("a3bd9o3v")[0] || !listingsRaw[i].getElementsByClassName("dco85op0")[0]) 
            continue;

        var link = listingsRaw[i].getElementsByTagName("a")[0].href;

        var image = listingsRaw[i].getElementsByTagName("img")[0];
        var imageSrc = image ? image.src : "";
        var price = listingsRaw[i].getElementsByClassName("oi732d6d")[0].innerText;
        var description = listingsRaw[i].querySelectorAll("span > div.l9j0dhe7.stjgntxs.ni8dbmo4")[0].innerText;
        var posY = listingsRaw[i].offsetTop;
        var location = listingsRaw[i].getElementsByClassName("dco85op0")[0].innerText;
        
        listings.push({
            link: link,
            imageSrc: imageSrc,
            price: price,
            description: description,
            location: location,
            posY: posY
        });
    }

    return listings;
}

//document.getElementsByClassName("hyh9befq")[22].querySelectorAll("span > div.l9j0dhe7.stjgntxs.ni8dbmo4")[0].innerText;

//Object equivilance
function isEquivalent(clientObj, serverObj) {
    // Create arrays of property names
    var aProps = Object.getOwnPropertyNames(clientObj);
    var bProps = Object.getOwnPropertyNames(serverObj);

    for (var i = 0; i < aProps.length; i++) {
        var propName = aProps[i];

        if(propName == "posY")
            continue;

        if (clientObj[propName] !== serverObj[propName]) {
            return false;
        }
    }

    // If we made it this far, objects
    // are considered equivalent
    return true;
}

var uniqueId = function() {
    return 'id-' + Math.random().toString(36).substr(2, 16);
};

function setChromePath(){
    pathsToTry = ['/usr/bin/chromium-browser', '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome'];

    for (let i = 0; i < pathsToTry.length; i++) {
        const path = pathsToTry[i];

        if (fs.existsSync(path))
            return path;
        
    }
}

nodeCleanup(() => {
    process.exit(cleanup())
});

async function cleanup()
{
    browser = await puppeteer.connect({browserWSEndpoint});   
    browser.close();
}

// makeSearchesCron.start();