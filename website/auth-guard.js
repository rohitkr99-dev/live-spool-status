const SESSION_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

let authChecked = false;

function updateActivity() {
    localStorage.setItem("lastActivity", Date.now());
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
