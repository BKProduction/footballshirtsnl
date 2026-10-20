let all = [];
let cat = "";

const grid = document.querySelector("#grid");
const detail = document.querySelector("#detail");
const q = document.querySelector("#q");

const esc = value => String(value || "").replace(
  /[&<>\"]/g,
  character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  })[character]
);

function category(album) {
  return album.category || album.title?.split(/\s+/)[0] || "Overig";
}

function proxyImage(source, width = 700) {
  if (!source) return "";

  return "https://wsrv.nl/?url=" +
    encodeURIComponent(source) +
    "&w=" + width +
    "&fit=inside&output=webp&q=82";
}

function imageMarkup(source, alt, width, extraClass = "") {
  const original = esc(source);
  const proxied = esc(proxyImage(source, width));

  return `<img
    class="${esc(extraClass)}"
    loading="lazy"
    decoding="async"
    referrerpolicy="no-referrer"
    src="${proxied}"
    data-original="${original}"
    alt="${esc(alt)}"
    onerror="if(this.dataset.original && this.src !== this.dataset.original){this.src=this.dataset.original;this.removeAttribute('data-original')}else{this.classList.add('image-error')}"
  >`;
}

function render() {
  detail.hidden = true;
  grid.hidden = false;

  const term = q.value.trim().toLowerCase();

  const list = all.filter(album => {
    const matchesCategory = !cat || category(album) === cat;
    const matchesSearch = (album.title || "").toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });

  document.querySelector("#meta").textContent = `${list.length} albums`;

  grid.innerHTML = list.map(album => {
    const cover = album.coverUrl || album.images?.[0] || "";

    return `<article class="card" data-id="${esc(album.sourceId)}">
      ${imageMarkup(cover, album.title, 500, "album-cover")}
      <div>${esc(album.title)}</div>
    </article>`;
  }).join("");

  document.querySelectorAll(".card").forEach(card => {
    card.onclick = () => openAlbum(card.dataset.id);
  });
}

function openAlbum(id) {
  const album = all.find(item => String(item.sourceId) === String(id));
  if (!album) return;

  grid.hidden = true;
  detail.hidden = false;

  const photos = (album.images || [])
    .filter(source => source && source.includes("photo.yupoo.com/minkang/"));

  detail.innerHTML = `
    <button class="back">← Terug</button>
    <h1>${esc(album.title)}</h1>
    <p>${photos.length} foto's</p>
    <div class="photos">
      ${photos.map((source, index) => imageMarkup(
        source,
        `${album.title} foto ${index + 1}`,
        1200,
        "album-photo"
      )).join("")}
    </div>
  `;

  detail.querySelector(".back").onclick = render;
}

fetch("./data/catalog.json", { cache: "no-store" })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Catalogus kon niet worden geladen: ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    all = (data.albums || []).filter(album =>
      album.coverUrl || (album.images && album.images.length > 0)
    );

    const categories = [...new Set(all.map(category))].sort();

    document.querySelector("#cats").innerHTML = categories.map(name =>
      `<button data-cat="${esc(name)}">${esc(name)}</button>`
    ).join("");

    document.querySelectorAll("[data-cat]").forEach(button => {
      button.onclick = () => {
        cat = button.dataset.cat;
        document.querySelector("#heading").textContent = cat || "Alle albums";
        render();
      };
    });

    render();
  })
  .catch(error => {
    grid.innerHTML = `<p>De catalogus kon niet worden geladen: ${esc(error.message)}</p>`;
  });

q.oninput = render;
