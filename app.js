const express = require("express");
const app = express();
const mongoose = require("mongoose");
const axios = require("axios");
const convert = require("xml-js");
const countryNames = require("./myfile");
const bodyParser = require("body-parser");
app.use(express.json());
app.use(bodyParser.json());
const cron = require("cron");

/*
const MAX_RETRIES = 3;
const RETRY_DELAY = 500; // milliseconds
const REQUEST_TIMEOUT = 5000; // milliseconds
const CONCURRENCY = 5;
*/

app.get("/get_countries", (req, res) => {
  const filter = req.query.filter || ""; // Get the filter parameter from the query string
  const filteredCountries = countryNames.filter((country) =>
    country.toLowerCase().includes(filter.toLowerCase())
  );

  const countriesAsString = filteredCountries.join(", "); // Join the filtered countries into a single string

  res.send({ filtered_countries: countriesAsString });
});

//const mongoDBUrl = "mongodb://localhost:27017/wotnot";
const mongoDBUrl = "mongodb://127.0.0.1:27017/wotnot";

mongoose.connect(mongoDBUrl, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;

db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
  console.log("Connected to MongoDB database");
});

const productSchema = new mongoose.Schema({
  product_id: Number,
  url: String,
  images: [String],
  country: String,
  region: String,
  city: String,
  city_url: String,
  country_url: String,
  region_url: String,
  description_long: String,
  latitude: Number,
  longitude: Number,
  address: String,
  zipcode: String,
  min_person: Number,
  service_type: String,
  transport_type: String,
  accommodation: String,
  usps: String,
  stars: Number,
  rating: Number,
  name: String,
  departureDate: Date,
  duration: Number,
  price: String,
  currency: String,
  // ... other fields as needed
});

const Product = mongoose.model("Product", productSchema);
// Create a model using the schema
module.exports = Product;
// ... (your route handlers and other code)

app.post("/xml-to-json-db", async (req, res) => {
  try {
    const requestData = req.body;
    const xmlUrls = requestData.urls;

    if (!Array.isArray(xmlUrls)) {
      return res.status(400).send("Invalid request data");
    }

    await fetchAndInsertData(xmlUrls);
    res.status(200).send("Data fetched and inserted successfully");
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

const job = new cron.CronJob("*/5 * * * *", async () => {
  try {
    console.log("Fetching and inserting data...");
    const xmlUrls = [
      "https://pf.tradetracker.net/?aid=452842&encoding=utf-8&type=xml-v2&fid=2084000&categoryType=2&additionalType=2",
      "https://pf.tradetracker.net/?aid=452842&encoding=utf-8&type=xml-v2&fid=1480778&categoryType=2&additionalType=2",
      "https://pf.tradetracker.net/?aid=452842&encoding=utf-8&type=xml-v2&fid=1480781&categoryType=2&additionalType=2",
      "https://pf.tradetracker.net/?aid=452842&encoding=utf-8&type=xml-v2&fid=1480790&categoryType=2&additionalType=2",
      "https://pf.tradetracker.net/?aid=452842&encoding=utf-8&type=xml-v2&fid=1480792&categoryType=2&additionalType=2",
    ];
    await fetchAndInsertData(xmlUrls);
    console.log("Data fetch and insert complete.");
  } catch (error) {
    console.error("Error in cron job:", error);
  }
});

job.start();

async function fetchAndInsertData(xmlUrls) {
  try {
    const jsonDataList = await Promise.all(
      xmlUrls.map(async (xmlUrl) => {
        let jsonData = null;

        try {
          const response = await axios.get(xmlUrl);
          const xmlData = response.data;

          jsonData = convert.xml2json(xmlData, {
            compact: true,
            spaces: 2,
          });
          jsonData = JSON.parse(jsonData);
        } catch (error) {
          console.error(`Error fetching XML:`, error.message);
        }

        return jsonData;
      })
    );

    const allData = jsonDataList
      .map((data) => data && data.products && data.products.product)
      .flat()
      .filter((item) => item);

    if (allData.length > 0) {
      const customizedData = await customizeData(allData);

      const existingProducts = await Product.find({
        product_id: { $in: customizedData.map((data) => data.product_id) },
      });

      const newProducts = customizedData.filter((data) => {
        return !existingProducts.some(
          (existingProduct) => existingProduct.product_id === data.product_id
        );
      });

      if (newProducts && newProducts.length > 0) {
        await Product.insertMany(newProducts);
        console.log("New products inserted:", newProducts);
      } else {
        console.log("Data Already Existed");
      }
    } else {
      console.log("No data fetched from XML.");
    }
  } catch (error) {
    console.log("Error:", error.message);
  }
}
function customizeData(dataArray) {
  let currentProductId = 0;
  const filteredData = dataArray.map((item) => {
    const {
      URL,
      images,
      properties: { property },
      name,
      price,
    } = item;

    const propertyMap = {};
    property.forEach((prop) => {
      const propName = prop._attributes.name;
      propertyMap[propName] = prop.value._text;
    });

    const imageList = Array.isArray(images && images.image)
      ? images.image.map((img) => (img._text ? img._text : ""))
      : images && images.image && images.image._text
      ? [images.image._text]
      : [];

    const productData = {
      product_id: currentProductId++, // Assign the product ID and increment
      url: URL && URL._text ? URL._text : "",
      images: imageList,
      country: propertyMap.country || "",
      region: propertyMap.region || "",
      city: propertyMap.city || "",
      city_url: propertyMap.cityURL || "",
      country_url: propertyMap.countryURL || "",
      region_url: propertyMap.regionURL || "",
      description_long: propertyMap.descriptionLong || "",
      latitude: parseFloat(propertyMap.latitude) || 0,
      longitude: parseFloat(propertyMap.longitude) || 0,
      address: propertyMap.address || "",
      zipcode: propertyMap.zipcode || "",
      min_person: parseInt(propertyMap.minPersons) || 0,
      service_type: propertyMap.serviceType || "",
      transport_type: propertyMap.transportType || "",
      accommodation: propertyMap.accommodation || "",
      usps: propertyMap.usps || "",
      stars: parseFloat(propertyMap.stars) || 0,
      rating: parseFloat(propertyMap.rating) || 0,
      name: name && name._text ? name._text : "",
      departureDate: propertyMap.departureDate || null,
      duration: parseInt(propertyMap.duration) || 0,
      price: price && price._text ? price._text : "",
      currency:
        price && price._attributes.currency ? price._attributes.currency : "",
    };
    return productData;
  });

  return filteredData;
}

app.post("/filter-database-data", async (req, res) => {
  try {
    const filters = req.body;

    let filter = {};

    if (filters.name) {
      filter.name = filters.name;
    }

    if (filters.transportType) {
      filter.transport_type = filters.transportType;
    }

    if (filters.min_person) {
      filter.min_person = { $gte: parseInt(filters.min_person) };
    }

    if (filters.duration) {
      filter.duration = { $lte: parseInt(filters.duration) };
    }

    if (filters.max_price) {
      filter.price = { $lte: parseFloat(filters.max_price) };
    }

    if (filters.currency) {
      filter.currency = filters.currency;
    }

    // Fetch filtered data from the database
    console.log("Filter Object:", filter);
    // Fetch data from the database based on filters
    const filteredProducts = await Product.find(filter);

    console.log("Filtered Products:", filteredProducts);

    if (filteredProducts.length > 0) {
      res.send({ data: filteredProducts });
    } else {
      res.send({ data: [] });
    }
  } catch (error) {
    console.log("Error:", error.message);
    res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Running a GraphQL API server at http://localhost:${PORT}`);
});
