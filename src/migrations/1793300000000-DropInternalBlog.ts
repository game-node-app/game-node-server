import { MigrationInterface, QueryRunner } from "typeorm";

export class DropInternalBlog1793300000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query("DROP TABLE `blog_post_tags_blog_post_tag`");
        await queryRunner.query("DROP TABLE `blog_post_review`");
        await queryRunner.query("DROP TABLE `blog_post`");
        await queryRunner.query("DROP TABLE `blog_post_image`");
        await queryRunner.query("DROP TABLE `blog_post_tag`");
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`blog_post_tag\` (\`id\` varchar(255) NOT NULL, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`blog_post_image\` (\`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`id\` int NOT NULL AUTO_INCREMENT, \`mimetype\` varchar(255) NOT NULL, \`extension\` varchar(255) NOT NULL, \`size\` int NOT NULL, \`filename\` varchar(255) NOT NULL, \`encoding\` varchar(255) NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`blog_post_review\` (\`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`postId\` varchar(255) NOT NULL, \`gameId\` bigint NOT NULL, \`rating\` float NOT NULL, PRIMARY KEY (\`postId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`blog_post\` (\`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`id\` varchar(36) NOT NULL, \`title\` varchar(255) NOT NULL, \`content\` longtext NOT NULL, \`isDraft\` tinyint NOT NULL DEFAULT 1, \`profileUserId\` varchar(255) NOT NULL, \`imageId\` int NOT NULL, INDEX \`IDX_9670853ecc08f9ae3fc594b7db\` (\`id\`, \`createdAt\`, \`isDraft\`), UNIQUE INDEX \`REL_fb86aba3b3fdb50278131d3e32\` (\`imageId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`blog_post_tags_blog_post_tag\` (\`blogPostId\` varchar(36) NOT NULL, \`blogPostTagId\` varchar(255) NOT NULL, INDEX \`IDX_38a7f84ed1095efe6d535ed162\` (\`blogPostId\`), INDEX \`IDX_e17f448c9a104a7e19ae705617\` (\`blogPostTagId\`), PRIMARY KEY (\`blogPostId\`, \`blogPostTagId\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`blog_post_review\` ADD CONSTRAINT \`FK_d8bdcf69aa10e6ff844348ce64f\` FOREIGN KEY (\`gameId\`) REFERENCES \`game\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`blog_post_review\` ADD CONSTRAINT \`FK_baf434b45c9d5e53c75b8f40ea2\` FOREIGN KEY (\`postId\`) REFERENCES \`blog_post\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`blog_post\` ADD CONSTRAINT \`FK_d4b917eafad2fe1afff7ae8dcd2\` FOREIGN KEY (\`profileUserId\`) REFERENCES \`profile\`(\`userId\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`blog_post\` ADD CONSTRAINT \`FK_fb86aba3b3fdb50278131d3e325\` FOREIGN KEY (\`imageId\`) REFERENCES \`blog_post_image\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`blog_post_tags_blog_post_tag\` ADD CONSTRAINT \`FK_38a7f84ed1095efe6d535ed1628\` FOREIGN KEY (\`blogPostId\`) REFERENCES \`blog_post\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE \`blog_post_tags_blog_post_tag\` ADD CONSTRAINT \`FK_e17f448c9a104a7e19ae7056175\` FOREIGN KEY (\`blogPostTagId\`) REFERENCES \`blog_post_tag\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
    }
}
