import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsString, ValidateNested } from 'class-validator';


export class PaymentSessionDto {


  @IsString()
  orderId: string;


  @IsString()
  currency: string;


  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type( () => PaymentSessionItemDto )
  items: PaymentSessionItemDto[];

}


export class PaymentSessionItemDto {

  @IsString()
  name: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  price: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity: number;



}

