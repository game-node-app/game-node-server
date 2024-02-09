const axios = require("axios");

axios
    .get("http://localhost:5000/v1/health")
    .then((response) => {
        if (response.data.status !== "ok") {
            process.exit(1);
        }
    })
    .catch(() => {
        process.exit(1);
    });
