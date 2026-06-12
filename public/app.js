const API_BASE = "http://localhost:5000";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadPropertyTypes() {
  try {
    const res = await fetch(`${API_BASE}/api/property-types`);
    if (!res.ok) return;
    const { types } = await res.json();
    const sel = document.getElementById("propertyType");
    types.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn("Could not load property types:", e.message);
  }
}

async function loadListings(params = {}) {
  const grid = document.getElementById("listingsGrid");
  const spinner = document.getElementById("loadingSpinner");
  const noResults = document.getElementById("noResults");
  const noDb = document.getElementById("noDbAlert");
  const countBadge = document.getElementById("resultsCount");

  grid.innerHTML = "";
  spinner.classList.remove("d-none");
  noResults.classList.add("d-none");
  if (noDb) noDb.classList.add("d-none");

  try {
    const qs = new URLSearchParams();
    if (params.market) qs.set("market", params.market);
    if (params.property_type) qs.set("property_type", params.property_type);
    if (params.bedrooms) qs.set("bedrooms", params.bedrooms);

    const res = await fetch(`${API_BASE}/api/listings?${qs}`);
    const data = await res.json();

    spinner.classList.add("d-none");

    if (!res.ok || data.error) {
      // Database not connected
      if (noDb) noDb.classList.remove("d-none");
      countBadge.textContent = "";
      return "db_error";
    }

    const listings = data.listings || [];

    if (listings.length === 0) {
      noResults.classList.remove("d-none");
      countBadge.textContent = "0 results";
      return;
    }

    countBadge.textContent = `${listings.length} result${listings.length !== 1 ? "s" : ""}`;

    listings.forEach((listing) => {
      const col = document.createElement("div");
      col.className = "col-md-6 col-lg-4";

      const rating = listing.review_scores_rating;
      const ratingHtml =
        rating !== null && rating !== undefined
          ? `<span class="rating-badge"><i class="bi bi-star-fill me-1"></i>${rating}</span>`
          : `<span class="badge bg-light text-muted border">Not rated</span>`;

      const imgHtml = listing.picture_url
        ? `<img src="${escapeHtml(listing.picture_url)}" class="card-img-top"
                       alt="${escapeHtml(listing.name)}"
                       onerror="this.parentElement.innerHTML='<div class=\\'listing-img-placeholder\\'><i class=\\'bi bi-house\\'></i></div>'">`
        : `<div class="listing-img-placeholder"><i class="bi bi-house"></i></div>`;

      const bedroomText =
        listing.bedrooms != null
          ? `<small class="text-muted mt-2 d-block">
                       <i class="bi bi-door-closed me-1"></i>${listing.bedrooms} bedroom${listing.bedrooms !== 1 ? "s" : ""}
                   </small>`
          : "";

      col.innerHTML = `
                <div class="card listing-card h-100">
                    ${imgHtml}
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            ${ratingHtml}
                            <span class="badge bg-light text-secondary border ms-auto">
                                ${escapeHtml(listing.property_type || "")}
                            </span>
                        </div>
                        <h5 class="card-title mb-1">
                            <a href="bookings.html?listing_id=${encodeURIComponent(listing.listing_id)}"
                               class="listing-title-link">
                               ${escapeHtml(listing.name)}
                            </a>
                        </h5>
                        <p class="summary-text mb-3">${escapeHtml(listing.summary || "")}</p>
                        <div class="mt-auto d-flex justify-content-between align-items-center">
                            <div>
                                <i class="bi bi-geo-alt text-muted me-1"></i>
                                <small class="text-muted">${escapeHtml(listing.market || "")}</small>
                            </div>
                            <span class="price-badge">
                                $${listing.price ? listing.price.toFixed(0) : "?"}/night
                            </span>
                        </div>
                        ${bedroomText}
                    </div>
                    <div class="card-footer bg-transparent border-0 pt-0 pb-3">
                        <a href="bookings.html?listing_id=${encodeURIComponent(listing.listing_id)}"
                           class="btn btn-danger btn-sm w-100">
                           <i class="bi bi-calendar-plus me-1"></i>Book Now
                        </a>
                    </div>
                </div>`;

      grid.appendChild(col);
    });
  } catch (e) {
    spinner.classList.add("d-none");
    if (noDb) noDb.classList.remove("d-none");
    console.error("Load listings error:", e);
  }
}

document.getElementById("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const market = document.getElementById("location").value.trim();
  const property_type = document.getElementById("propertyType").value;
  const bedrooms = document.getElementById("bedrooms").value;

  document.getElementById("resultsTitle").innerHTML =
    `<i class="bi bi-house-door text-danger me-2"></i>Results for "${escapeHtml(market)}"`;

  await loadListings({ market, property_type, bedrooms });
});

// On page load: populate dropdowns and show random listings.
// Retry once after 2s in case the DB connection isn't ready yet.
async function initPage() {
  await loadPropertyTypes();
  const firstTry = await loadListings();
  if (firstTry === "db_error") {
    setTimeout(() => loadListings(), 2000);
  }
}

initPage();
