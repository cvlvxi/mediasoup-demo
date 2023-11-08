# Submodules

```
git submodule update --recursive --init
```

# Node 18

```
nodenv local 18.3.0
```

# Build mediasoup & mediasoup-client & mediasoup-client-aiortc

```
pushd mediasoup;
yarn;
popd;

pushd mediasoup-client;
yarn;
yarn typescript:build;
popd;

pushd mediasoup-client-aiortc;
pip install worker/
yarn;
yarn typescript:build;
popd;
```

# Self Signing Server

```sh
mkdir -p server/certs
pushd server/certs
openssl req -x509 -sha256 -nodes -days 1825 -newkey rsa:2048 -keyout privkey.pem -out fullchain.pem
popd;
```

# Installing Server

```
cd server;
cp config.example.js config.js;
yarn;
```

# Installing App

```
cd app;
yarn;
```

# Installing aiortc client

```
cd aiortc
yarn;
yarn typescript:build;
```


# Start

```sh
# Server
cd server; yarn start;

# app
cd app; yarn start;


```

