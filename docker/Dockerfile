FROM nginx:alpine

# git runs at container start: the entrypoint pulls before nginx serves.
RUN apk add --no-cache git

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
