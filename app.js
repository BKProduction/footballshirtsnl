let catalog = { products: [] };

let section = "";
let category = "";
let subcategory = "";
let club = "";

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

function formatNumber(value) {
  return Number(value || 0).toLocaleString("nl-NL");
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
      product.club || "";

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
        new Set()
      );
    }

    if (clubName) {
      categoryGroup
        .get(subcategoryName)
        .add(clubName);
    }
  }

  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        a.localeCompare(
          b,
          "nl"
        )
    )
    .map(
      ([
        sectionName,
        categoryMap
      ]) => [
        sectionName,

        [
          ...categoryMap.entries()
        ]
          .sort(
            ([a], [b]) =>
              a.localeCompare(
                b,
                "nl"
              )
          )
          .map(
            ([
              categoryName,
              subcategoryMap
            ]) => [
              categoryName,

              [
                ...subcategoryMap.entries()
              ]
                .sort(
                  ([a], [b]) =>
                    a.localeCompare(
                      b,
                      "nl"
                    )
                )
                .map(
                  ([
                    subcategoryName,
                    clubs
                  ]) => [
                    subcategoryName,

                    [...clubs].sort(
                      (a, b) =>
                        a.localeCompare(
                          b,
                          "nl"
                        )
                    )
                  ]
                )
            ]
          )
      ]
    );
}

function countProducts(filters = {}) {
  return products().filter(
    product => {
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

      return true;
    }
  ).length;
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
        active ? " active" : ""
      }"
      ${attributes}
    >
      <span>${esc(label)}</span>
      ${countText}
    </button>
  `;
}

function renderNavigation() {
  const groups =
    groupedProducts();

  const totalProducts =
    products().length;

  categories.innerHTML = [
    navButton(
      "Alles",
      {},
      !section &&
        !category &&
        !subcategory &&
        !club,
      totalProducts
    ),

    ...groups.map(
      ([
        sectionName,
        categoryGroups
      ]) => {
        const sectionCount =
          countProducts({
            section: sectionName
          });

        return `
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

              ${categoryGroups
                .map(
                  ([
                    categoryName,
                    subcategoryGroups
                  ]) => {
                    const categoryCount =
                      countProducts({
                        section:
                          sectionName,
                        category:
                          categoryName
                      });

                    return `
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

                          ${subcategoryGroups
                            .map(
                              ([
                                subcategoryName,
                                clubs
                              ]) => {
                                const subcategoryCount =
                                  countProducts(
                                    {
                                      section:
                                        sectionName,
                                      category:
                                        categoryName,
                                      subcategory:
                                        subcategoryName
                                    }
                                  );

                                return `
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

                                      ${clubs
                                        .map(
                                          clubName => {
                                            const clubCount =
                                              countProducts(
                                                {
                                                  section:
                                                    sectionName,
                                                  category:
                                                    categoryName,
                                                  subcategory:
                                                    subcategoryName,
                                                  club:
                                                    clubName
                                                }
                                              );

                                            return navButton(
                                              clubName,
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
                                              section ===
                                                sectionName &&
                                                category ===
                                                  categoryName &&
                                                subcategory ===
                                                  subcategoryName &&
                                                club ===
                                                  clubName,
                                              clubCount
                                            );
                                          }
                                        )
                                        .join(
                                          ""
                                        )}
                                    </div>
                                  </details>
                                `;
                              }
                            )
                            .join("")}
                        </div>
                      </details>
                    `;
                  }
                )
                .join("")}
            </div>
          </details>
        `;
      }
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
            .subcategory ||
          "";

        club =
          button.dataset.club ||
          "";

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
    product =>
      (
        !section ||
        productSection(
          product
        ) === section
      ) &&
      (
        !category ||
        productCategory(
          product
        ) === category
      ) &&
      (
        !subcategory ||
        productSubcategory(
          product
        ) === subcategory
      ) &&
      (
        !club ||
        product.club === club
      ) &&
      (
        !term ||
        searchableText(
          product
        ).includes(term)
      )
  );
}

function renderProducts() {
  detail.hidden = true;
  grid.hidden = false;

  const filtered =
    filteredProducts();

  const currentHeading =
    club ||
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

        const label = [
          productSubcategory(
            product
          ),
          product.club
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
    .querySelectorAll(".card")
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
    product.images || [];

  const breadcrumb = [
    productSection(product),
    productCategory(product),
    productSubcategory(
      product
    ),
    product.club
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
          (
            src,
            index
          ) => `
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

function showLoadError(
  error
) {
  console.error(
    "Catalogusfout:",
    error
  );

  grid.innerHTML = `
    <p class="error">
      Catalogus kon niet worden geladen:
      ${esc(error.message)}
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

    const data =
      await response.json();

    catalog = data;

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
