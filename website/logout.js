function logout() {

    firebase.auth().signOut()

    .then(function () {

        sessionStorage.clear();

        window.location.replace("login.html");

    })

    .catch(function (error) {

        console.error(error);

    });

}
