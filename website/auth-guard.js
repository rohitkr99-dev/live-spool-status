const SESSION_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

function updateActivity() {
    localStorage.setItem("lastActivity", Date.now());
}

firebase.auth().onAuthStateChanged(function(user) {

    if (!user) {
        window.location.replace("login.html");
        return;
    }

    const lastActivity = Number(localStorage.getItem("lastActivity"));

    if (!lastActivity) {
        updateActivity();
    }

    if (Date.now() - lastActivity > SESSION_TIMEOUT) {

        firebase.auth().signOut().then(function () {
            localStorage.clear();
            sessionStorage.clear();
            window.location.replace("login.html");
        });

        return;
    }

    updateActivity();

    ["click","mousemove","keydown","touchstart"].forEach(function(event){

        document.addEventListener(event, updateActivity);

    });

    setInterval(function(){

        const last = Number(localStorage.getItem("lastActivity"));

        if(Date.now() - last > SESSION_TIMEOUT){

            firebase.auth().signOut().then(function(){

                localStorage.clear();
                sessionStorage.clear();

                window.location.replace("login.html");

            });

        }

    },60000);

});
a
