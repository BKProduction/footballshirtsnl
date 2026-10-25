let catalog = { products: [] };

let section = "";
let category = "";
let subcategory = "";
let club = "";
let season = "";

const grid = document.querySelector("#grid");
const detail = document.querySelector("#detail");
const query = document.querySelector("#q");
const categories = document.querySelector("#cats");
const heading = document.querySelector("#heading");
const meta = document.querySelector("#meta");

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
  );

function products() {
  return Array.isArray(catalog.products)
    ? catalog.products
    : Array.isArray(catalog.albums)
      ? catalog.albums
      : [];
}

function productSection(product) {
  return (
    product.section ||
    (product.competition
      ? "Voetbal"
      : "Overige producten")
  );
}

function productCategory(product) {
  return (
    product.category ||
    (product.club
      ? "Clubteams"
      : "Overige producten")
  );
}

function productSubcategory(product) {
  return (
    product.subcategory ||
    product.competition ||
    product.sourceCategory ||
    product.sourceCollection ||
    "Overig"
  );
}

function productClub(product) {
  return product.club || "";
}

function productSeason(product) {
  return (
    product.season ||
    "Onbekend seizoen"
  );
}

function seasonSort(first, second) {
  if (
    first === "Onbekend seizoen" &&
    second !== "Onbekend seizoen"
  ) {
    return 1;
  }

  if (
    second === "Onbekend seizoen" &&
    first !== "Onbekend seizoen"
  ) {
    return -1;
  }

  const firstYear =
    Number(
      String(first).match(
        /\d{4}/
      )?.[0] || 0
    );

  const secondYear =
    Number(
      String(second).match(
        /\d{4}/
      )?.[0] || 0
    );

  return (
    secondYear - firstYear ||
    String(second).localeCompare(
      String(first),
      "nl"
    )
  );
}

function groupedProducts() {
  const groups = new Map();

  for (const product of products()) {
    const sectionName =
      productSection(product);

    const categoryName =
      productCategory(product);

    const subcategoryName =
      productSubcategory(product);

    const clubName =
      productClub(product);

    const seasonName =
      productSeason(product);

    if (!groups.has(sectionName)) {
      groups.set(
        sectionName,
        new Map()
      );
    }

    const sectionGroup =
      groups.get(sectionName);

    if (
      !sectionGroup.has(
        categoryName
      )
    ) {
      sectionGroup.set(
        categoryName,
        new Map()
      );
    }

    const categoryGroup =
      sectionGroup.get(
        categoryName
      );

    if (
      !categoryGroup.has(
        subcategoryName
      )
    ) {
      categoryGroup.set(
        subcategoryName,
        new Map()
      );
    }

    const subcategoryGroup =
      categoryGroup.get(
        subcategoryName
      );

    const clubKey =
      clubName || "Overig";

    if (
      !subcategoryGroup.has(
        clubKey
      )
    ) {
      subcategoryGroup.set(
        clubKey,
        new Set()
      );
    }

    subcategoryGroup
      .get(clubKey)
      .add(seasonName);
  }

  return [...groups.entries()]
    .sort(
      ([first], [second]) =>
        first.localeCompare(
          second,
          "nl"
        )
    )
    .map(
      ([
        sectionName,
        categoryMap
      ]) => [
        sectionName,

        [...categoryMap.entries()]
          .sort(
            ([first], [second]) =>
              first.localeCompare(
                second,
                "nl"
              )
          )
          .map(
            ([
              categoryName,
              subcategoryMap
            ]) => [
              categoryName,

              [...subcategoryMap.entries()]
                .sort(
                  ([first], [second]) =>
                    first.localeCompare(
                      second,
                      "nl"
                    )
                )
                .map(
                  ([
                    subcategoryName,
                    clubMap
                  ]) => [
                    subcategoryName,

                    [...clubMap.entries()]
                      .sort(
                        ([first], [second]) =>
                          first.localeCompare(
                            second,
                            "nl"
                          )
                      )
                      .map(
                        ([
                          clubName,
                          seasons
                        ]) => [
                          clubName,
                          [...seasons].sort(
                            seasonSort
                          )
                        ]
                      )
                  ]
                )
            ]
          )
      ]
    );
}

function navButton(
  label,
  data = {},
  active = false
) {
  const attributes =
    Object.entries(data)
      .map(
        ([key, value]) =>
          `data-${key}="${esc(
            value
          )}"`
      )
      .join(" ");

  return `
    <button
      class="nav-pill${
        active
          ? " active"
          : ""
      }"
      ${attributes}
    >
      ${esc(label)}
    </button>
  `;
}

function renderNavigation() {
  const groups =
    groupedProducts();

  categories.innerHTML = [
    navButton(
      "Alles",
      {},
      !section &&
        !category &&
        !subcategory &&
        !club &&
        !season
    ),

    ...groups.map(
      ([
        sectionName,
        categoryGroups
      ]) => `
        <details
          class="nav-group"
          ${
            section ===
            sectionName
              ? "open"
              : ""
          }
        >
          <summary>
            ${esc(sectionName)}
            <span>
              ${
                categoryGroups.length
              }
            </span>
          </summary>

          <div class="nav-level">

            ${navButton(
              `Alles binnen ${sectionName}`,
              {
                section:
                  sectionName
              },
              section ===
                sectionName &&
                !category
            )}

            ${categoryGroups
              .map(
                ([
                  categoryName,
                  subcategoryGroups
                ]) => `
                  <details
                    ${
                      category ===
                      categoryName
                        ? "open"
                        : ""
                    }
                  >
                    <summary>
                      ${esc(
                        categoryName
                      )}
                      <span>
                        ${
                          subcategoryGroups.length
                        }
                      </span>
                    </summary>

                    <div class="nav-level">

                      ${navButton(
                        `Alles binnen ${categoryName}`,
                        {
                          section:
                            sectionName,

                          category:
                            categoryName
                        },
                        category ===
                          categoryName &&
                          !subcategory
                      )}

                      ${subcategoryGroups
                        .map(
                          ([
                            subcategoryName,
                            clubGroups
                          ]) => `
                            <details
                              ${
                                subcategory ===
                                subcategoryName
                                  ? "open"
                                  : ""
                              }
                            >
                              <summary>
                                ${esc(
                                  subcategoryName
                                )}

                                <span>
                                  ${
                                    clubGroups.length
                                  }
                                </span>
                              </summary>

                              <div class="nav-level">

                                ${navButton(
                                  `Alles binnen ${subcategoryName}`,
                                  {
                                    section:
                                      sectionName,

                                    category:
                                      categoryName,

                                    subcategory:
                                      subcategoryName
                                  },
                                  subcategory ===
                                    subcategoryName &&
                                    !club
                                )}

                                ${clubGroups
                                  .map(
                                    ([
                                      clubName,
                                      seasons
                                    ]) => `
                                      <details
                                        ${
                                          club ===
                                          clubName
                                            ? "open"
                                            : ""
                                        }
                                      >
                                        <summary>
                                          ${esc(
                                            clubName
                                          )}

                                          <span>
                                            ${
                                              seasons.length
                                            }
                                          </span>
                                        </summary>

                                        <div class="nav-level">

                                          ${navButton(
                                            `Alles van ${clubName}`,
                                            {
                                              section:
                                                sectionName,

                                              category:
                                                categoryName,

                                              subcategory:
                                                subcategoryName,

                                              club:
                                                clubName
                                            },
                                            club ===
                                              clubName &&
                                              !season
                                          )}

                                          ${seasons
                                            .map(
                                              seasonName =>
                                                navButton(
                                                  seasonName,
                                                  {
                                                    section:
                                                      sectionName,

                                                    category:
                                                      categoryName,

                                                    subcategory:
                                                      subcategoryName,

                                                    club:
                                                      clubName,

                                                    season:
                                                      seasonName
                                                  },
                                                  club ===
                                                    clubName &&
                                                    season ===
                                                      seasonName
                                                )
                                            )
                                            .join(
                                              ""
                                            )}

                                        </div>
                                      </details>
                                    `
                                  )
                                  .join("")}

                              </div>
                            </details>
                          `
                        )
                        .join("")}

                    </div>
                  </details>
                `
              )
              .join("")}

          </div>
        </details>
      `
    )
  ].join("");

  categories
    .querySelectorAll(
      "button"
    )
    .forEach(button => {
      button.onclick = () => {
        section =
          button.dataset
            .section || "";

        category =
          button.dataset
            .category || "";

        subcategory =
          button.dataset
            .subcategory || "";

        club =
          button.dataset
            .club || "";

        season =
          button.dataset
            .season || "";

        renderNavigation();
        renderProducts();
      };
    });
}

function searchableText(product) {
  return [
    product.title,
    product.section,
    product.category,
    product.subcategory,
    product.country,
    product.competition,
    product.club,
    product.season,
    product.source,
    ...(product.types || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function renderProducts() {
  detail.hidden = true;
  grid.hidden = false;

  const term =
    query.value
      .trim()
      .toLowerCase();

  const filtered =
    products().filter(
      product =>
        (!section ||
          productSection(
            product
          ) === section) &&

        (!category ||
          productCategory(
            product
          ) === category) &&

        (!subcategory ||
          productSubcategory(
            product
          ) ===
            subcategory) &&

        (!club ||
          productClub(
            product
          ) === club) &&

        (!season ||
          productSeason(
            product
          ) === season) &&

        (!term ||
          searchableText(
            product
          ).includes(term))
    );

  const currentHeading =
    season ||
    club ||
    subcategory ||
    category ||
    section ||
    "Alle producten";

  heading.textContent =
    currentHeading;

  meta.textContent =
    `${filtered.length} product${
      filtered.length === 1
        ? ""
        : "en"
    }`;

  grid.innerHTML =
    filtered.length
      ? filtered
          .map(product => {
            const id =
              product.uniqueKey ||
              `${
                product.source ||
                "minkang"
              }:${
                product.sourceId
              }`;

            const image =
              product.coverUrl ||
              product.images?.[0] ||
              "";

            const label = [
              productSubcategory(
                product
              ),

              productClub(
                product
              ),

              productSeason(
                product
              )
            ]
              .filter(Boolean)
              .join(" · ");

            return `
              <article
                class="card"
                data-id="${esc(
                  id
                )}"
              >

                ${
                  image
                    ? `
                      <img
                        class="album-cover"
                        loading="lazy"
                        decoding="async"
                        src="${esc(
                          image
                        )}"
                        alt="${esc(
                          product.title
                        )}"
                      >
                    `
                    : ""
                }

                <div class="card-copy">

                  <span>
                    ${esc(
                      label ||
                        productCategory(
                          product
                        )
                    )}
                  </span>

                  <strong>
                    ${esc(
                      product.title
                    )}
                  </strong>

                  <small>
                    ${esc(
                      product.imageCount ||
                        product.images
                          ?.length ||
                        0
                    )} foto's${
                      product.source
                        ? ` · ${esc(
                            product.source
                          )}`
                        : ""
                    }
                  </small>

                </div>
              </article>
            `;
          })
          .join("")
      : `
        <p class="empty-state">
          Geen producten gevonden binnen deze selectie.
        </p>
      `;

  grid
    .querySelectorAll(
      ".card"
    )
    .forEach(card => {
      card.onclick = () =>
        openProduct(
          card.dataset.id
        );
    });
}

function openProduct(id) {
  const product =
    products().find(item => {
      const itemId =
        item.uniqueKey ||
        `${
          item.source ||
          "minkang"
        }:${item.sourceId}`;

      return itemId === id;
    });

  if (!product) {
    return;
  }

  grid.hidden = true;
  detail.hidden = false;

  const images =
    product.images || [];

  const breadcrumb = [
    productSection(product),
    productCategory(product),
    productSubcategory(product),
    productClub(product),
    productSeason(product)
  ]
    .filter(Boolean)
    .join(" › ");

  detail.innerHTML = `

    <button
      class="back"
      type="button"
    >
      ← Terug naar overzicht
    </button>

    <p class="eyebrow">
      ${esc(breadcrumb)}
    </p>

    <h1>
      ${esc(product.title)}
    </h1>

    ${
      product.types?.length
        ? `
          <p>
            ${esc(
              product.types.join(
                " · "
              )
            )}
          </p>
        `
        : ""
    }

    <div class="detail-photos">

      ${images
        .map(
          (src, index) => `
            <img
              loading="lazy"
              decoding="async"
              src="${esc(src)}"
              alt="${esc(
                product.title
              )} foto ${
                index + 1
              }"
            >
          `
        )
        .join("")}

    </div>
  `;

  detail.querySelector(
    ".back"
  ).onclick =
    renderProducts;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

fetch(
  "./data/catalog.json",
  {
    cache: "no-store"
  }
)
  .then(response => {
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return response.json();
  })
  .then(data => {
    catalog = data;

    renderNavigation();
    renderProducts();
  })
  .catch(error => {
    grid.innerHTML = `
      <p class="error">
        Catalogus kon niet worden geladen:
        ${esc(error.message)}
      </p>
    `;
  });

query.oninput =
  renderProducts;
