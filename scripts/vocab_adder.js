let selection = null;
let words = [];

// Track highlighted text
document.addEventListener("mouseup", () => {
    if (window.getSelection) selection = window.getSelection().toString().trim();
});

// Add word with Ctrl+Shift+X
document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "x") {
        event.preventDefault();
        if (selection && !words.includes(selection)) {
            words.push(selection);
            console.log("Captured word:", selection);
            localStorage.setItem("selectedWords", JSON.stringify(words));
        }
    }
});

// Send words every 5 seconds
setInterval(async () => {
    if (words.length === 0) return;

    const wordsToSend = [...words];
    words = [];

    try {
        const res = await fetch("https://j2agvnprddidwvrmsnrozj3afy0bzfsc.lambda-url.us-east-2.on.aws/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: "testUser", words: wordsToSend })
        });

        if (!res.ok) {
            console.error("Lambda returned status: ", res.status);
        }
        const data = await res.json();
        console.log("Lambda response:", data);

        // Optionally: store saved words with definitions locally
        if (data.saved) {
            localStorage.setItem("savedWords", JSON.stringify(data.saved));
        }
    } catch (err) {
        console.error("Failed to send words:", err);
        words.push(...wordsToSend); // retry next interval
    }
}, 5000);

// Save unsent words to localStorage on page unload
window.addEventListener("beforeunload", () => {
    localStorage.setItem("selectedWords", JSON.stringify(words));
});
