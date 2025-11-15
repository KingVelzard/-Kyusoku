function renderReadingTime(article)
{
    // if there is no article, we don't have to render anything
    if (!article) {
        return;
    }

    const text = article.textContent;
    const wordMatchRegExp = /[^\s]+/g; // reg expression
    const words = text.matchAll(wordMatchRegExp);
    //words is an iterator of the word tokens, need to create an arr
    const wordCount = [...words].length;
    const readingTime = Math.round(wordCount / 200);
    const badge = document.createElement("p");
    // use the same style as the publish information in an articles header
    badge.classList.add("color-secondary-text", "type--caption");
    badge.textContent = `⏱️ ${readingTime} min read`;

    // for api ref docs
    const heading = article.querySelector("h1");
    const date = article.querySelector("time")?.parentNode;

    (date ?? heading).insertAdjacentElement("afterend", badge);

}

renderReadingTime(document.querySelector("article"));

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        //if a new article was added
        for (const node of mutation.addedNodes) {
            if (node instanceof Element && node.tagName === 'ARTICLE') {
                // render the reading time for this article
                renderReadingTime(node);
            }
        }
    }
});

// https://developer.chrome.com/ is a SPA (Single Page Application) so can
// update the address bar and render new content without reloading. Our content
// script won't be reinjected when this happens, so we need to watch for
// changes to the content.

observer.observe(document.querySelector('devsite-content'), {
    childList: true
});