let catalog = { products: [] };

let section = "";
let category = "";
let subcategory = "";
let club = "";
let season = "";

let visibleLimit = 120;

const PAGE_SIZE = 120;

const grid = document.querySelector("#grid");
const detail = document.querySelector("#detail");
const query = document.querySelector("#q");
const categories = document.querySelector("#cats");
const heading = document.querySelector("#heading");
const meta = document.querySelector("#meta");

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
  );

function products() {
  if (Array.isArray(catalog.products)) {
    return catalog.products;
  }

  if (Array.isArray(catalog.albums)) {
    return catalog.albums;
  }

  return [];
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

function fullSeasonYear(shortYear) {
  const year = Number(shortYear);

  if (!Number.isFinite(year)) {
    return null;
  }

  return year >= 50
    ? 1900 + year
    : 2000 + year;
}

function normalizeSeason(
  firstYear,
  secondYear
) {
  let first;

  if (
    String(firstYear).length === 2
  ) {
    first =
      fullSeasonYear(firstYear);
  } else {
    first =
      Number(firstYear);
  }

  if (!first) {
    return "";
  }

  let second;

  if (
    String(secondYear).length === 4
  ) {
    second =
      Number(secondYear);
  } else {
    second =
      Math.floor(first / 100) *
        100 +
      Number(secondYear);

    if (second < first) {
      second += 100;
    }
  }

  if (
    !Number.isFinite(second)
  ) {
    return "";
  }

  return `${first}-${second}`;
}

function productSeason(product) {
  /*
   * Eerst kijken of in catalog.json
   * al expliciet een season staat.
   */
  if (
    product.season &&
    String(product.season).trim()
  ) {
    const explicitSeason =
      String(product.season);

    const explicitMatch =
      explicitSeason.match(
        /\b((?:19|20)?\d{2})\s*[\/_-]\s*((?:19|20)?\d{2})\b/
      );

    if (explicitMatch) {
      return normalizeSeason(
        explicitMatch[1],
        explicitMatch[2]
      );
    }

    return explicitSeason.trim();
  }

  /*
   * Anders seizoen uit titel halen.
   *
   * Ondersteunt bijvoorbeeld:
   *
   * 24/25
   * 24-25
   * 24_25
   *
   * 2024/25
   * 2024-25
   * 2024_25
   *
   * 2024/2025
   * 2024-2025
   * 2024_2025
   */
  const title =
    String(product.title || "");

  const fullMatch =
    title.match(
      /\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)\d{2})\b/
    );

  if (fullMatch) {
    return normalizeSeason(
      fullMatch[1],
      fullMatch[2]
    );
  }

  const mixedMatch =
    title.match(
      /\b((?:19|20)\d{2})\s*[\/_-]\s*(\d{2})\b/
    );

  if (mixedMatch) {
    return normalizeSeason(
      mixedMatch[1],
      mixedMatch[2]
    );
  }

  const shortMatch =
    title.match(
      /\b(\d{2})\s*[\/_-]\s*(\d{2})\b/
    );

  if (shortMatch) {
    return normalizeSeason(
      shortMatch[1],
      shortMatch[2]
    );
  }

  return "Seizoen onbekend";
}

function formatNumber(value) {
  return Number(
    value || 0
  ).toLocaleString("nl-NL");
}

function productMatches(
  product,
  filters = {}
) {
  if (
    filters.section &&
    productSection(product) !==
      filters.section
  ) {
    return false;
  }

  if (
    filters.category &&
    productCategory(product) !==
      filters.category
  ) {
    return false;
  }

  if (
    filters.subcategory &&
    productSubcategory(product) !==
      filters.subcategory
  ) {
    return false;
  }

  if (
    filters.club &&
    (product.club || "") !==
      filters.club
  ) {
    return false;
  }

  if (
    filters.season &&
    productSeason(product) !==
      filters.season
  ) {
    return false;
  }

  return true;
}

function countProducts(
  filters = {}
) {
  let count = 0;

  for (
    const product of products()
  ) {
    if (
      productMatches(
        product,
        filters
      )
    ) {
      count++;
    }
  }

  return count;
}

function groupedProducts() {
  const groups =
    new Map();

  for (
    const product of products()
  ) {
    const sectionName =
      productSection(product);

    const categoryName =
      productCategory(product);

    const subcategoryName =
      productSubcategory(product);

    const clubName =
      product.club ||
      "Overig";

    const seasonName =
      productSeason(product);

    if (
      !groups.has(
        sectionName
      )
    ) {
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

    if (
      !subcategoryGroup.has(
        clubName
      )
    ) {
      subcategoryGroup.set(
        clubName,
        new Set()
      );
    }

    subcategoryGroup
      .get(clubName)
      .add(seasonName);
  }

  return groups;
}

function seasonSort(
  first,
  second
) {
  if (
    first ===
    "Seizoen onbekend"
  ) {
    return 1;
  }

  if (
    second ===
    "Seizoen onbekend"
  ) {
    return -1;
  }

  const firstYear =
    Number(
      first.split("-")[0]
    ) || 0;

  const secondYear =
    Number(
      second.split("-")[0]
    ) || 0;

  return (
    secondYear -
    firstYear
  );
}

function navButton(
  label,
  data = {},
  active = false,
  count = null
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

  const countText =
    count !== null
      ? `<span>${formatNumber(
          count
        )}</span>`
      : "";

  return `
    <button
      class="nav-pill${
        active
          ? " active"
          : ""
      }"
      ${attributes}
    >
      <span>
        ${esc(label)}
      </span>

      ${countText}
    </button>
  `;
}

function renderNavigation() {
  const groups =
    groupedProducts();

  let html = navButton(
    "Alles",
    {},
    !section &&
      !category &&
      !subcategory &&
      !club &&
      !season,
    products().length
  );

  const sortedSections =
    [...groups.entries()]
      .sort(
        ([a], [b]) =>
          a.localeCompare(
            b,
            "nl"
          )
      );

  for (
    const [
      sectionName,
      categoryGroups
    ] of sortedSections
  ) {
    const sectionCount =
      countProducts({
        section:
          sectionName
      });

    html += `
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
            ${formatNumber(
              sectionCount
            )}
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
              !category,
            sectionCount
          )}
    `;

    const sortedCategories =
      [
        ...categoryGroups
          .entries()
      ].sort(
        ([a], [b]) =>
          a.localeCompare(
            b,
            "nl"
          )
      );

    for (
      const [
        categoryName,
        subcategoryGroups
      ] of sortedCategories
    ) {
      const categoryCount =
        countProducts({
          section:
            sectionName,
          category:
            categoryName
        });

      html += `
        <details
          ${
            section ===
              sectionName &&
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
              ${formatNumber(
                categoryCount
              )}
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
              section ===
                sectionName &&
                category ===
                  categoryName &&
                !subcategory,
              categoryCount
            )}
      `;

      const sortedSubcategories =
        [
          ...subcategoryGroups
            .entries()
        ].sort(
          ([a], [b]) =>
            a.localeCompare(
              b,
              "nl"
            )
        );

      for (
        const [
          subcategoryName,
          clubGroups
        ] of sortedSubcategories
      ) {
        const subcategoryCount =
          countProducts({
            section:
              sectionName,
            category:
              categoryName,
            subcategory:
              subcategoryName
          });

        html += `
          <details
            ${
              section ===
                sectionName &&
              category ===
                categoryName &&
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
                ${formatNumber(
                  subcategoryCount
                )}
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
                section ===
                  sectionName &&
                  category ===
                    categoryName &&
                  subcategory ===
                    subcategoryName &&
                  !club,
                subcategoryCount
              )}
        `;

        const sortedClubs =
          [
            ...clubGroups
              .entries()
          ].sort(
            ([a], [b]) =>
              a.localeCompare(
                b,
                "nl"
              )
          );

        for (
          const [
            clubName,
            seasons
          ] of sortedClubs
        ) {
          const clubFilterName =
            clubName ===
            "Overig"
              ? ""
              : clubName;

          const clubCount =
            countProducts({
              section:
                sectionName,
              category:
                categoryName,
              subcategory:
                subcategoryName,
              ...(clubFilterName
                ? {
                    club:
                      clubFilterName
                  }
                : {})
            });

          html += `
            <details
              ${
                club ===
                clubFilterName
                  ? "open"
                  : ""
              }
            >
              <summary>
                ${esc(
                  clubName
                )}
                <span>
                  ${formatNumber(
                    clubCount
                  )}
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
                    ...(clubFilterName
                      ? {
                          club:
                            clubFilterName
                        }
                      : {})
                  },
                  club ===
                    clubFilterName &&
                    !season,
                  clubCount
                )}
          `;

          const sortedSeasons =
            [...seasons]
              .sort(
                seasonSort
              );

          for (
            const seasonName of
              sortedSeasons
          ) {
            const seasonCount =
              countProducts({
                section:
                  sectionName,
                category:
                  categoryName,
                subcategory:
                  subcategoryName,

                ...(clubFilterName
                  ? {
                      club:
                        clubFilterName
                    }
                  : {}),

                season:
                  seasonName
              });

            html += navButton(
              seasonName,
              {
                section:
                  sectionName,
                category:
                  categoryName,
                subcategory:
                  subcategoryName,

                ...(clubFilterName
                  ? {
                      club:
                        clubFilterName
                    }
                  : {}),

                season:
                  seasonName
              },
              season ===
                seasonName,
              seasonCount
            );
          }

          html += `
              </div>
            </details>
          `;
        }

        html += `
            </div>
          </details>
        `;
      }

      html += `
          </div>
        </details>
      `;
    }

    html += `
        </div>
      </details>
    `;
  }

  categories.innerHTML =
    html;

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
            .subcategory ||
          "";

        club =
          button.dataset
            .club || "";

        season =
          button.dataset
            .season || "";

        visibleLimit =
          PAGE_SIZE;

        renderNavigation();
        renderProducts();

        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      };
    });
}

function searchableText(
  product
) {
  return [
    product.title,
    product.section,
    product.category,
    product.subcategory,
    product.country,
    product.competition,
    product.club,
    productSeason(product),
    product.source,
    ...(product.types || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filteredProducts() {
  const term =
    query.value
      .trim()
      .toLowerCase();

  return products().filter(
    product => {
      if (
        !productMatches(
          product,
          {
            section,
            category,
            subcategory,
            club,
            season
          }
        )
      ) {
        return false;
      }

      if (
        term &&
        !searchableText(
          product
        ).includes(term)
      ) {
        return false;
      }

      return true;
    }
  );
}

function renderProducts() {
  detail.hidden = true;
  grid.hidden = false;

  const filtered =
    filteredProducts();

  const currentHeading =
    [
      club,
      season
    ]
      .filter(Boolean)
      .join(" · ") ||
    subcategory ||
    category ||
    section ||
    "Alle producten";

  heading.textContent =
    currentHeading;

  meta.textContent =
    `${formatNumber(
      filtered.length
    )} ${
      filtered.length === 1
        ? "product"
        : "producten"
    }`;

  if (!filtered.length) {
    grid.innerHTML = `
      <p class="empty-state">
        Geen producten gevonden binnen deze selectie.
      </p>
    `;

    return;
  }

  const visible =
    filtered.slice(
      0,
      visibleLimit
    );

  const cards =
    visible
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

        const seasonName =
          productSeason(
            product
          );

        const label = [
          product.club,
          seasonName !==
          "Seizoen onbekend"
            ? seasonName
            : "",
          product.types
            ?.join(" · ")
        ]
          .filter(Boolean)
          .join(" · ");

        const imageCount =
          product.imageCount ||
          product.images
            ?.length ||
          0;

        return `
          <article
            class="card"
            data-id="${esc(id)}"
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
                : `
                  <div
                    class="album-cover no-image"
                  >
                    Geen foto
                  </div>
                `
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
                  imageCount
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
      .join("");

  const moreButton =
    visible.length <
    filtered.length
      ? `
        <div
          class="load-more-wrap"
          style="
            grid-column: 1 / -1;
            text-align: center;
            padding: 24px;
          "
        >
          <button
            id="loadMore"
            type="button"
            style="
              padding: 12px 24px;
              cursor: pointer;
              border-radius: 8px;
            "
          >
            Meer producten laden
            (${formatNumber(
              visible.length
            )} van ${formatNumber(
              filtered.length
            )})
          </button>
        </div>
      `
      : "";

  grid.innerHTML =
    cards + moreButton;

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

  const loadMore =
    document.querySelector(
      "#loadMore"
    );

  if (loadMore) {
    loadMore.onclick = () => {
      visibleLimit +=
        PAGE_SIZE;

      renderProducts();
    };
  }
}

function openProduct(id) {
  const product =
    products().find(
      item => {
        const itemId =
          item.uniqueKey ||
          `${
            item.source ||
            "minkang"
          }:${
            item.sourceId
          }`;

        return itemId === id;
      }
    );

  if (!product) {
    return;
  }

  grid.hidden = true;
  detail.hidden = false;

  const images =
    Array.isArray(
      product.images
    )
      ? product.images
      : [];

  const seasonName =
    productSeason(product);

  const breadcrumb = [
    productSection(product),
    productCategory(product),
    productSubcategory(
      product
    ),
    product.club,
    seasonName !==
    "Seizoen onbekend"
      ? seasonName
      : ""
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
      ${esc(
        product.title
      )}
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

      ${
        images.length
          ? images
              .map(
                (
                  src,
                  index
                ) => `
                  <img
                    loading="lazy"
                    decoding="async"
                    src="${esc(
                      src
                    )}"
                    alt="${esc(
                      product.title
                    )} foto ${
                      index + 1
                    }"
                  >
                `
              )
              .join("")
          : `
            <p class="empty-state">
              Voor dit product zijn nog geen foto's opgeslagen.
            </p>
          `
      }

    </div>
  `;

  detail.querySelector(
    ".back"
  ).onclick = () => {
    renderProducts();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  };

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function showLoadError(error) {
  console.error(
    "Catalogusfout:",
    error
  );

  grid.innerHTML = `
    <p class="error">
      Catalogus kon niet worden geladen:
      ${esc(
        error.message
      )}
    </p>
  `;

  heading.textContent =
    "Catalogus";

  meta.textContent =
    "Laden mislukt";
}

async function loadCatalog() {
  try {
    const response =
      await fetch(
        `./data/catalog.json?v=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    catalog =
      await response.json();

    console.log(
      `[FootballshirtsNL] Catalogus geladen: ${products().length} producten`
    );

    renderNavigation();
    renderProducts();
  } catch (error) {
    showLoadError(error);
  }
}

query.oninput = () => {
  visibleLimit =
    PAGE_SIZE;

  renderProducts();
};

loadCatalog();
