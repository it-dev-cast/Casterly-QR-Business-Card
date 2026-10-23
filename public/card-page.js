// Public card page: /c/<slug>
(() => {
  "use strict";
  const page = document.getElementById("cardPage");
  const slug = (location.pathname.match(/^\/c\/([A-Za-z0-9]+)\/?$/) || [])[1] || new URLSearchParams(location.search).get("s");

  function showMessage(title, text) {
    page.innerHTML = `<div class="card-status"><div><h2>${Card.esc(title)}</h2><p>${Card.esc(text)}</p></div></div>`;
  }

  async function load() {
    if (!slug) return showMessage("Card not found", "This link is incomplete. Please scan the QR code again.");
    try {
      const { card, banner } = await Api.getPublicCard(slug);
      document.title = `${card.name} · ${card.designation}`;
      page.innerHTML = Card.cardHTML(card, banner);
      page.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-save-contact]")) location.href = Api.publicVCardUrl(slug);
      });
    } catch (err) {
      if (err.status === 404) showMessage("Card not found", "This card may have been removed. Please ask for a new QR code.");
      else showMessage("Couldn't load this card", err.message);
    }
  }

  load();
})();
