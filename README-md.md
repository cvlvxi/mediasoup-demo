# Submodules

```
git submodule update --recursive --init
```

# Node 18

```
nodenv local 18.3.0
```

# Build mediasoup

```
cd mediasoup;
yarn;
```

# Self Signing

```sh
mkdir -p server/certs
pushd server/certs
openssl req -x509 -sha256 -nodes -days 1825 -newkey rsa:2048 -keyout privkey.pem -out fullchain.pem
popd;
```

# Installing

```
cd server;
cp config.example.js config.js;
yarn;
```
