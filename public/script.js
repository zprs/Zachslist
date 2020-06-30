socket = io.connect('http://localhost:8080');

socket.on('scrape', function(data){
    $("#mainSearch").hide();
    $(".spinner").hide();
    $("#specialListings").show();

    if(data.filters.id)
        window.location.hash = data.filters.id;

    filterScrape(data.scrapeData, data.filters);
    formatScrape(data.scrapeData, data.filters);
    colorPrices();

    console.log(data.url);
});

socket.on('noSavedSearches', function(data){
    alert("Your email has not been linked to any saved searches :(");
});

function populateSearchTerms(searchObj, dataset){

    searchObj.find("#pst").empty();
    searchObj.find("#nst").empty();
    searchObj.find("#sst").empty();

    for (let i = 0; i < dataset.positiveTerms.length; i++) {
        const term = dataset.positiveTerms[i];
        searchObj.find("#pst").append(createTermListItem(term));
    }

    for (let i = 0; i < dataset.negitiveTerms.length; i++) {
        const term = dataset.negitiveTerms[i];
        searchObj.find("#nst").append(createTermListItem(term));
    }

    for (let i = 0; i < dataset.specialTerms.length; i++) {
        const term = dataset.specialTerms[i];
        searchObj.find("#sst").append(createTermListItem(term));
    }

    $(".termItem").on('click', function (e) {
        this.remove();
    });
}

socket.on('loadSavedSearches', function(data){

    $("#mainSearch").hide();
    clearSavedSearches();

    for (let i = 0; i < data.length; i++) {
        const dataset = data[i];
        
        var searchObj = $("#savedSearchTemplate").clone();

        populateSearchTerms(searchObj, dataset);

        searchObj.find("#savedMinPrice").html(dataset.minPrice);
        searchObj.find("#savedMaxPrice").html(dataset.maxPrice);
        searchObj.find("#savedZip").html(dataset.zip);
        searchObj.find("#savedRadius").html(dataset.radius);

        var savedSearchId = "savedSearch" + i;

        searchObj.attr("id", savedSearchId);
        searchObj.show();
        $("#savedSearches").append(searchObj);

        setupSearchObjectFunctions(savedSearchId, Object.assign({}, dataset));
    }
});

function setupSearchObjectFunctions(searchObjId, dataset){

    var searchObj = $("#" + searchObjId); 

    searchObj.find("#submitSavedSearch").on('click', function (e) {
        $(".searchFeilds").hide();
        $(".spinner").show();
        socket.emit("search", {searchFromId: true, searchId: dataset.id});
    });

    searchObj.find("#editSavedSearch").on('click', function(e)
    {
        $("#minPrice").val(dataset.minPrice);
        $("#maxPrice").val(dataset.maxPrice);
        $("#zip").val(dataset.zip);
        $("#radius").val(dataset.radius);

        $("#saveSearch").is(":checked");
        $("#inputEmail").val();

        populateSearchTerms($("#mainSearch"), dataset);

        clearSavedSearches();

        searchEditingId = dataset.id;

        $("#viewSavedSearchesDiv").hide();
        $("#searchSaving").hide();
        $("#searchUpdating").show();
        $("#mainSearch").show();

        $("#updateSavedSearch").on('click', function(e)
        {
            var data = congregateData($("#mainSearch"));
            data.email = dataset.email;
            data.id = dataset.id;

            $("#viewSavedSearchesDiv").show();

            socket.emit("updateSavedSearch", data);
            setTimeout(viewSavedSearches(), 200);
            
        });
    });

    searchObj.find("#deleteSavedSearch").on('click', function(e)
    {
        var response = confirm("Are you sure you would like to delete this saved search?");

        if(response)
        {
            var sendData = 
            {
                email: dataset.email,
                id: dataset.id
            }

            socket.emit("deleteSavedSearch", sendData);
            $("#" + searchObjId).remove();

            if($("#savedSearches").children().length <= 1)
                $("#mainSearch").show();
        }
    });
}

function filterScrape(scrapedData, filters)
{
    var numberOfFilteredListings = 0;
    var filteredData = scrapedData;

    for (let i = 0; i < filteredData.length; i++) {
        const listing = filteredData[i];


        for (let x = 0; x < filters.negitiveTerms.length; x++) {
            const term = filters.negitiveTerms[x];

            if(listing.description.toLowerCase().includes(term.toLowerCase()))
            {
                filteredData.splice(i, 1);
                numberOfFilteredListings++;
                break;
            }
        }
    }

    console.log("Number of filtered listings: " + numberOfFilteredListings);
    return filteredData;
}

var searchEditingId;

//loops through every entry and formats the scraped data
function formatScrape(data, filters)
{
    var html = "";
    var specialhtml = "";

    for(var i = 0; i < data.length; i++)
    {
        var temp = "";
        var entry = data[i];

        temp += '<a class="listingEntry" href="' + entry.link + '" target="_blank">';
        
        temp += '<div class="listingPrice">' + entry.price + '</div>';
        
        if(entry.imageSrc != "")
            temp += '<img src="' + entry.imageSrc + '" class="listingImage">';

       
        temp += '<p class="listingDescription">' + entry.description + '</p>';

        temp += '</a>'

        var isSpecial = false;

        for (let i = 0; i < filters.specialTerms.length; i++) {
            const term = filters.specialTerms[i];
            
            if(entry.description.toLowerCase().includes(term.toLowerCase()))
            {
                specialhtml += temp;
                isSpecial = true;
                break;
            }   
        }

        if(!isSpecial)
            html += temp;
        
    }

    $("#specialListings").html(specialhtml);
    $("#listings").html(html);
}

function colorPrices() {
    var minPrice = $("#minPrice").val();
    var maxPrice = $("#maxPrice").val();

    if(minPrice && maxPrice)
    {
        if(parseInt(minPrice) > parseInt(maxPrice))
            alert("please set the min below the max");
        else
        {
            var listingPrices = $(".listingPrice");

            for (let i = 0; i < listingPrices.length; i++) {
                var price = listingPrices[i];

                var pricePercent = (price.innerHTML.substr(1) - minPrice) / (maxPrice - minPrice)
                var r = Math.min(Math.round(pricePercent * 100 + 200), 255);
                var g = Math.min(Math.round((1 - pricePercent) * 100 + 200), 255);
                var b = 200;

                price.style.background = ("rgb(" + r + "," + g + "," + b + ")");
            }
        }
            
    }
}

//Key Ditection
$("#pstInput, #nstInput, #sstInput").on('keyup', function (e) {

    var inputValue = $(this);

    if (e.keyCode === 13 && inputValue.val() != "") {

        var noSpaces = inputValue.val().replace(/\s/g, '');
        inputValue.val(noSpaces);

        var list;

        switch(inputValue.attr('id'))
        {
            case "pstInput":
                list = $("#pst");
            break;
            case "nstInput":
                list = $("#nst");
            break;
            case "sstInput":
                list = $("#sst");
            break;
        }

        var newitem = createTermListItem(inputValue.val());

        for (let i = 0; i < list.children().length; i++) {
            const child = list.children()[i];
            
            if(child.innerHTML ==  inputValue.val())
                return;
        }

        list.append(newitem);
        inputValue.val("");

        $(".termItem").on('click', function (e) {
            this.remove();
        });
    }
});

function createTermListItem(term)
{
    return '<li class="termItem">' + term + '</li>';
}

$("#viewSavedSearches").on('click', function (e) {
    viewSavedSearches();
});

function clearSavedSearches()
{
    var template = $('#savedSearches #savedSearchTemplate').detach();
    $('#savedSearches').empty().append(template);
}

function viewSavedSearches()
{
    var data = {
        email: $("#savedEmail").val()
    }

    clearSavedSearches();

    socket.emit("viewSavedSearches", data);
}

$("#submitSearch").on('click', function (e) {

    $(".searchFeilds").hide();
    $(".spinner").show();
    socket.emit("search", congregateData($("#mainSearch")));
});

function congregateData(parent)
{
    return data = {
        minPrice: parent.find("#minPrice").val(),
        maxPrice: parent.find("#maxPrice").val(),
        zip: parent.find("#zip").val(), 
        radius: parent.find("#radius").val(), 
        positiveTerms: parent.find("#pst").children().toArray().map(val => val.innerText),
        negitiveTerms: parent.find("#nst").children().toArray().map(val => val.innerText),
        specialTerms: parent.find("#sst").children().toArray().map(val => val.innerText),
        saveSearch: parent.find("#saveSearchCheck").is(":checked"),
        email: parent.find("#inputEmail").val()
    };
}

$("#saveSearchCheck").on('click', function(e)
{
    updateEmailInput();
});

function updateEmailInput()
{
    if($("#saveSearchCheck").is(":checked"))
    {
        $("#inputEmailLabel").show();
        $("#inputEmail").show();
    }
    else
    {
        $("#inputEmailLabel").hide();
        $("#inputEmail").hide();
    }
}

$(document).ready(function(){

    searchId = location.hash.substr(1);
    
    if(searchId != ""){
        $(".searchFeilds").hide();
        $(".spinner").show();
        socket.emit("search", {searchFromId: true, searchId: searchId});
    }
});

updateEmailInput();

$(".spinner").hide();
$("#specialListings").hide();