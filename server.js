const express = require("express");
const { MongoClient } = require("mongodb");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;
console.log(MONGODB_URI);
let db;

async function connectDB() {
  if (!MONGODB_URI) {
    console.warn("MONGODB_URI not set. Please add it to your .env file.");
    return;
  }
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db("sample_airbnb");
    console.log("Connected to MongoDB — sample_airbnb");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
  }
}

// Helper: convert Decimal128 price to a plain float
function toPrice(val) {
  if (!val) return 0;
  return parseFloat(val.toString());
}

// Helper: map a raw listing document to a clean API shape
function mapListing(l) {
  return {
    listing_id: l._id.toString(),
    name: l.name || "Unnamed Property",
    summary: l.summary || "",
    price: toPrice(l.price),
    review_scores_rating: l.review_scores?.review_scores_rating ?? null,
    market: l.address?.market || "",
    country: l.address?.country || "",
    property_type: l.property_type || "",
    room_type: l.room_type || "",
    bedrooms: l.bedrooms ?? 0,
    bathrooms: l.bathrooms ?? 0,
    accommodates: l.accommodates ?? 1,
    amenities: l.amenities || [],
    picture_url: l.images?.picture_url || "",
    host_name: l.host?.host_name || "",
    host_picture_url: l.host?.host_picture_url || "",
  };
}

// GET /api/property-types  — distinct values from DB
app.get("/api/property-types", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not connected" });
  try {
    const types = await db
      .collection("listingsAndReviews")
      .distinct("property_type");
    res.json({ types: types.filter(Boolean).sort() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/listings  — search/filter listings
// Query params: market (required for search), property_type, bedrooms
// If no params → return 12 random listings for the homepage
app.get("/api/listings", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not connected" });
  try {
    const { market, property_type, bedrooms } = req.query;

    // No filters → show random sample for homepage
    if (!market && !property_type && !bedrooms) {
      const listings = await db
        .collection("listingsAndReviews")
        .aggregate([
          { $sample: { size: 12 } },
          {
            $project: {
              name: 1,
              summary: 1,
              price: 1,
              "review_scores.review_scores_rating": 1,
              "address.market": 1,
              "address.country": 1,
              property_type: 1,
              room_type: 1,
              bedrooms: 1,
              "images.picture_url": 1,
            },
          },
        ])
        .toArray();
      return res.json({ listings: listings.map(mapListing) });
    }

    // Build filter query
    const query = {};
    if (market) {
      // Match address.market with case-insensitive regex
      query["address.market"] = { $regex: new RegExp(market.trim(), "i") };
    }
    if (property_type) {
      query["property_type"] = property_type;
    }
    if (bedrooms && bedrooms !== "") {
      query["bedrooms"] = parseInt(bedrooms, 10);
    }

    const listings = await db
      .collection("listingsAndReviews")
      .find(query)
      .project({
        name: 1,
        summary: 1,
        price: 1,
        "review_scores.review_scores_rating": 1,
        "address.market": 1,
        "address.country": 1,
        property_type: 1,
        room_type: 1,
        bedrooms: 1,
        "images.picture_url": 1,
      })
      .limit(20)
      .toArray();

    res.json({ listings: listings.map(mapListing) });
  } catch (err) {
    console.error("Listings error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/listing/:id  — single listing detail + its bookings
app.get("/api/listing/:id", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not connected" });
  try {
    const id = req.params.id;

    // _id in sample_airbnb is a plain string e.g. "10082422"
    const listing = await db
      .collection("listingsAndReviews")
      .findOne({ _id: id });
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    // Fetch existing bookings from the bookings collection
    const bookings = await db
      .collection("bookings")
      .find({ listingID: id })
      .project({
        arrivalDate: 1,
        departureDate: 1,
        numberOfGuests: 1,
        guest: 1,
      })
      .toArray();

    res.json({
      listing: {
        ...mapListing(listing),
        description: listing.description || "",
        existing_bookings: bookings.map((b) => ({
          arrival: b.arrivalDate,
          departure: b.departureDate,
          guests: b.numberOfGuests,
          guest: b.guest || [],
        })),
      },
    });
  } catch (err) {
    console.error("Listing detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings  — create a new booking in the bookings collection
app.post("/api/bookings", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not connected" });
  try {
    const {
      listing_id,
      guest_first_name,
      guest_last_name,
      guest_email,
      arrival_date,
      departure_date,
      number_of_guests,
      deposit_paid,
    } = req.body;

    // Validate required fields
    if (
      !listing_id ||
      !guest_first_name ||
      !guest_last_name ||
      !guest_email ||
      !arrival_date ||
      !departure_date
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const arrival = new Date(arrival_date);
    const departure = new Date(departure_date);
    if (departure <= arrival) {
      return res.status(400).json({ error: "Departure must be after arrival" });
    }

    const nights = Math.ceil((departure - arrival) / (1000 * 60 * 60 * 24));

    // Verify the listing exists
    const listing = await db
      .collection("listingsAndReviews")
      .findOne({ _id: listing_id });
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    const price = toPrice(listing.price);
    const deposit = parseFloat(deposit_paid) || 0;
    const total = nights * price;
    const balance = total - deposit;

    // Generate a sequential-looking booking ID
    const bookingId = "B" + Date.now();
    const clientId = "C" + Date.now();

    // Balance due date = 7 days before arrival
    const balanceDueDate = new Date(arrival);
    balanceDueDate.setDate(balanceDueDate.getDate() - 7);

    const bookingDoc = {
      _id: bookingId,
      listingID: listing_id,
      clientID: clientId,
      arrivalDate: arrival,
      departureDate: departure,
      depositPaid: deposit,
      balanceDue: balance,
      balanceDueDate: balanceDueDate,
      numberOfGuests: parseInt(number_of_guests, 10) || 1,
      guest: [
        {
          firstName: guest_first_name,
          lastName: guest_last_name,
          email: guest_email,
        },
      ],
    };

    await db.collection("bookings").insertOne(bookingDoc);

    res.json({
      success: true,
      booking: {
        booking_id: bookingId,
        client_id: clientId,
        listing_id,
        listing_name: listing.name,
        guest_first_name,
        guest_last_name,
        guest_email,
        arrival_date: arrival.toISOString(),
        departure_date: departure.toISOString(),
        nights,
        number_of_guests: bookingDoc.numberOfGuests,
        deposit_paid: deposit,
        balance_due: balance,
        balance_due_date: balanceDueDate.toISOString(),
        price_per_night: price,
        total,
      },
    });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/:listing_id  — all bookings for a listing
app.get("/api/bookings/:listing_id", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Database not connected" });
  try {
    const bookings = await db
      .collection("bookings")
      .find({ listingID: req.params.listing_id })
      .toArray();
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

connectDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
