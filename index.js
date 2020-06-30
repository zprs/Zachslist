const fs = require("fs");
const puppeteer = require("puppeteer");
const nodemailer = require('nodemailer');

var express = require('express');
var app = express();
var server = app.listen(8080, "0.0.0.0");

app.use(express.static('public'));
var io = require('socket.io')(server);

io.sockets.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('updateSavedSearch', function(data) {
        var obj = JSON.parse(fs.readFileSync('savedSearches.json', 'utf8'));
        var previousData = obj[data.email];

        for (let i = 0; i < previousData.length; i++) {
            const prevObj = previousData[i];

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

            let browser = await puppeteer.launch({
                headless: false,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
              });
            let page = await browser.newPage();

            // page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36');

            page.on('load', () => console.log("Loaded: " + page.url()));

            //Craigslist Scrape -----------------
            let craigslistURL = craigslistLinkGen(data.minPrice, data.maxPrice, data.zip, data.radius, data.positiveTerms, data.negitiveTerms);    
            await page.goto(craigslistURL, { waitUntil: 'networkidle0' });
        
            let CLScrapeData = await page.evaluate(extractCLItems);

            //Offer Up Scrape -------------------
            let offerUpURL = offerUpLinkGen(data.minPrice, data.maxPrice, data.radius, data.positiveTerms);
            await page.goto(offerUpURL, { waitUntil: 'networkidle0' });
            
            let OUScrapeData = await scrapeInfiniteScrollItems(page, extractOUItems, 50, data);

            //FBMP Scrape -------------------
            let fbmpURL = facebookMPLinkGen(data.minPrice, data.maxPrice, data.radius, data.positiveTerms);
            await page.goto(fbmpURL, { waitUntil: 'networkidle0' });

            let FBMPScrapeData = await scrapeInfiniteScrollItems(page, extractFBMPItems, 50, data);
            
            var totalNumberScraped = CLScrapeData.length + OUScrapeData.length + FBMPScrapeData.length;
            var combinedData = [];

            for (let i = 0; i < totalNumberScraped; i++) {
                if(i < CLScrapeData.length)
                    combinedData.push(CLScrapeData[i]);
                if(i < OUScrapeData.length)
                    combinedData.push(OUScrapeData[i]);
                if(i < FBMPScrapeData.length)
                    combinedData.push(FBMPScrapeData[i]);
            }

            await browser.close();
            socket.emit("scrape", {scrapeData: combinedData, urls: [craigslistURL, offerUpURL, fbmpURL], filters: data});
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

    var senderEmail = "zpr52024@gmail.com"

    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: senderEmail,
          pass: 'yourpassword'
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

async function scrapeInfiniteScrollItems(page, extractItems, itemTargetCount, filters, scrollStep = 300, scrollDelay = 10, maxItterations = 400) {
    let items = [];

    var scrollDistance = 0;
    var itemsStillNeedToLoad = true;


    var numberOfItterations = 0;

    while (items.length < itemTargetCount || itemsStillNeedToLoad && numberOfItterations < maxItterations) {

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
        await page.waitForFunction(`document.body.scrollHeight > ${scrollDistance}`);
        scrollDistance += scrollStep;
        
        await page.evaluate(() => {
            // click load more on OU
            var loadModeButton = document.querySelector("._1kjvp19  .ou-btn-special");
            if(loadModeButton)
                loadModeButton.click();
        });

        await page.waitFor(scrollDelay);

        console.log(items.length);

        if(items.length > 0)
            itemsStillNeedToLoad = items[items.length - 1].posY > scrollDistance;

        numberOfItterations++;
    }

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