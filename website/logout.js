function logout() {

    if (!confirm("Are you sure you want to logout?")) {
        return;
    }

    firebase.auth().signOut()

    .then(function () {

        sessionStorage.clear();
        localStorage.clear();

        window.location.replace("login.html");

    })

    .catch(function (error) {

        alert(error.message);

    });

}
