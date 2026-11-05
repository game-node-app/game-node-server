# Production Manticore image. Published as lamarcke/game-node-manticore:<hash of docker/manticore/**>
# by the Deploy workflow, so it is only rebuilt when a file in this directory changes.
FROM manticoresearch/manticore:29.9.0

COPY --chmod=755 entrypoint.sh reindex.sh /etc/manticoresearch/
COPY manticore.conf.template /etc/manticoresearch/

ENTRYPOINT ["/bin/bash", "/etc/manticoresearch/entrypoint.sh"]
CMD ["searchd", "--nodetach"]
