import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SourceController } from './source.controller';

@Module({ imports: [AuthModule], controllers: [SourceController] })
export class SourceModule {}
