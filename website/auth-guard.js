const SESSION_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

let authChecked = false;

function updateActivity() {
    localStorage.setItem("lastActivity", Date.now());
}

// The page starts hidden (see the inline <style> + auth-pending class
// in each page's <head>). This is the only place that reveals it -
// every other path through this file either redirects to login.html
// or leaves the page hidden, so a visitor never sees real content
// flash on screen before the login check finishes.
function revealPage() {
    document.documentElement.classList.remove("auth-pending");
}

firebase.auth().onAuthStateChanged(function(user) {

    // Ignore duplicate calls
    if (authChecked && user === null) {
        return;
    }

    authChecked = true;

    if (!user) {
        window.location.replace("login.html");
        return;
    }

    const lastActivity = Number(localStorage.getItem("lastActivity")) || Date.now();

    updateActivity();

    if (Date.now() - lastActivity > SESSION_TIMEOUT) {

        firebase.auth().signOut().then(function () {

            localStorage.clear();
            sessionStorage.clear();

            window.location.replace("login.html");

        });

        return;
    }

    revealPage();

    // once a day per person (and browser): tell the Cutting Station script that this person is on the website; it only feeds the admin's daily summary
    try {
        const day = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        if (localStorage.getItem("siteSeen") !== user.uid + "|" + day) {
            user.getIdToken().then(function (tok) {
                return fetch("https://script.google.com/macros/s/AKfycbzcxLVu9YxbFQKQzK56zZyzdFihEnfG3QrhRZEA-ESM89cxlqQ8lPHCPz2ZRKr4UgVZ/exec", {
                    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ action: "logVisit", area: "site", idToken: tok })
                });
            }).then(function (r) { return r.json(); }).then(function (r) {
                if (r && r.ok) localStorage.setItem("siteSeen", user.uid + "|" + day);
            }).catch(function () {});
        }
    } catch (e) {}

    ["click","mousemove","keydown","touchstart"].forEach(function(event){

        document.addEventListener(event, updateActivity, { passive: true });

    });

    setInterval(function(){

        const last = Number(localStorage.getItem("lastActivity")) || Date.now();

        if(Date.now() - last > SESSION_TIMEOUT){

            firebase.auth().signOut().then(function(){

                localStorage.clear();
                sessionStorage.clear();

                window.location.replace("login.html");

            });

        }

    },60000);

});
